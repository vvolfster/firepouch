import * as admin from "firebase-admin"
import { firestore } from "firebase-admin"
import { nanoid } from "nanoid"
import * as path from "path"
import { FirestorePouchDb, FirestorePouchDocument } from "./FirestorePouchDb"
import { archiveDirectory, extractZip, Logger, promiseChain, removeDir } from "./helpers"
import { getTempDir, getTempFileName } from "./helpers/getTempDir"
import { removeFile } from "./helpers/removeDir"

interface BackupParams {
    name?: string
    collectionNames?: string[]
    collectionNamesExclude?: string[]
}

interface BackupArchiveParams extends BackupParams {
    dest?: string
}

interface RestoreArchiveParams extends Omit<BackupParams, "name"> {
    path: string
}

interface BackupCloudStorageParams extends Omit<BackupParams, "name"> {
    path: string
    storage?: admin.storage.Storage
}

interface DumpToJsonParams extends Omit<BackupParams, "collectionNames"> {
    destination?: string
}

interface FirepouchConstructorParams {
    batchLimit?: number
    app?: admin.app.App
    initializeAppOptions?: {
        options?: admin.AppOptions | undefined
        name?: string | undefined
    }
}

interface FirestoreCollectionCursor {
    values: FirebaseFirestore.DocumentData[]
    next: undefined | (() => Promise<FirestoreCollectionCursor>)
}

export class Firepouch {
    app: admin.app.App
    batchLimit: number

    constructor(params: FirepouchConstructorParams) {
        this.batchLimit = params.batchLimit || 250
        if (params.app) {
            this.app = params.app
        } else if (params.initializeAppOptions) {
            this.app = admin.initializeApp(params.initializeAppOptions.options, params.initializeAppOptions.name)
        } else {
            throw new Error("Cannot create Firepouch without app or initializeAppOptions")
        }
    }

    private firestoreCollectionCursor = async (collectionName: string, startAfter?: string): Promise<FirestoreCollectionCursor> => {
        const collectionRef = admin.firestore().collection(collectionName)
        let ref = collectionRef.orderBy(firestore.FieldPath.documentId()).limit(this.batchLimit)
        if (startAfter) {
            ref = ref.startAfter(startAfter)
        }

        const results = await ref.get()
        const { docs } = results

        if (!docs.length) {
            return {
                values: [],
                next: undefined
            }
        }

        const lastId = docs[docs.length - 1].id

        return {
            values: docs,
            next: () => this.firestoreCollectionCursor(collectionName, lastId)
        }
    }

    private firestoreCollectionCursorForEach = async (
        collectionName: string,
        fn: (values: FirebaseFirestore.DocumentData[]) => Promise<any> | any
    ): Promise<number> => {
        return new Promise<number>((resolve, reject) => {
            let count = 0
            const advanceCursor = async (cursor?: FirestoreCollectionCursor) => {
                try {
                    if (!cursor) {
                        cursor = await this.firestoreCollectionCursor(collectionName)
                    }

                    count += cursor.values.length
                    await fn(cursor.values)

                    if (!cursor.next) {
                        return resolve(count)
                    } else {
                        const next = await cursor.next()
                        advanceCursor(next)
                    }
                } catch (e) {
                    return reject(e)
                }
            }
            advanceCursor()
        })
    }

    private backupCollection = async (collectionName: string, db: FirestorePouchDb, logger: Logger) => {
        logger.log(`${collectionName} backup starting...`)
        const startTime = new Date().getTime()
        const count = await this.firestoreCollectionCursorForEach(collectionName, async docs => {
            const ids = docs.map(d => d.id)
            const values: FirestorePouchDocument[] = docs.map(doc => {
                return {
                    collectionName,
                    id: doc.id,
                    data: doc.data()
                }
            })
            await db.bulkPut(ids, values)
        })
        logger.log(`${collectionName} backup finished with ${count} documents in ${new Date().getTime() - startTime} ms`)
        return count
    }

    private restoreCollection = async (collectionName: string, db: FirestorePouchDb, logger: Logger) => {
        logger.log(`${collectionName} restoreCollection starting...`)
        const collectionRef = admin.firestore().collection(collectionName)
        const startTime = new Date().getTime()

        const restoreCount = await db.collectionCursorForEach(collectionName, this.batchLimit, values => {
            const batch = admin.firestore().batch()
            values.forEach(val => {
                const ref = collectionRef.doc(val.id)
                batch.set(ref, val.data)
            })
            return batch.commit()
        })

        logger.log(`${collectionName} restored ${restoreCount} docs in ${new Date().getTime() - startTime} ms`)
        return restoreCount
    }

    private getDbPath = (params?: Omit<BackupParams, "collectionNames">) => {
        if (params?.name) {
            const dbPath = path.isAbsolute(params.name) ? params.name : path.resolve(process.cwd(), params.name)
            return dbPath
        }

        const now = new Date()
        const saveableDate = now.toISOString().split(":").join("_")
        return path.resolve(process.cwd(), `${saveableDate}---${nanoid()}`)
    }

    createBackup = async (params?: BackupParams) => {
        const now = new Date()
        removeDir(this.getDbPath(params))
        const db = new FirestorePouchDb(this.getDbPath(params))

        const dbName = path.basename(db.name)

        // now do the backup
        let collectionNames: string[] = []
        if (params?.collectionNames) {
            collectionNames = params.collectionNames
        } else {
            const allCollections = await this.app.firestore().listCollections()
            collectionNames = allCollections.map(c => c.id)
        }

        if (params?.collectionNamesExclude) {
            collectionNames = collectionNames.filter(name => !params.collectionNamesExclude?.includes(name))
        }

        const logger = new Logger(`firepouch.createBackup(${dbName})::`)
        logger.log(`Found collections:: ${JSON.stringify(collectionNames)}`)
        logger.log(`Creating backup to ${db.name}`)

        if (collectionNames.length) {
            const fns = collectionNames.map(name => {
                return () => this.backupCollection(name, db, logger)
            })
            await promiseChain(fns)
        }

        await db.meta.set({
            collectionNames,
            dateCreatedMs: now.getTime()
        })

        await db.close()
        logger.log(`Finished backing up in ${new Date().getTime() - now.getTime()} ms`)
    }

    createBackupToArchive = async (params?: BackupArchiveParams) => {
        const dbPath = this.getDbPath(params)
        await this.createBackup(params)
        const db = new FirestorePouchDb(dbPath)
        await db.close()
        const zipPath = await archiveDirectory(db.name, params?.dest || `${db.name}.zip`)
        return zipPath
    }

    createBackupToCloudStorage = async (params: BackupCloudStorageParams) => {
        const tempName = `createBackupToCloudStorage-${nanoid()}`
        const tempDir = getTempDir(tempName)
        const zipFile = `${getTempFileName(tempName)}.zip`
        await this.createBackupToArchive({
            name: tempDir,
            collectionNames: params.collectionNames,
            collectionNamesExclude: params.collectionNamesExclude,
            dest: zipFile
        })

        const storage = params.storage || this.app.storage()
        await storage.bucket().upload(zipFile, { destination: params.path })
        await removeDir(tempDir)
        await removeFile(zipFile)
    }

    restoreBackup = async (params?: BackupParams) => {
        const now = new Date()
        const db = new FirestorePouchDb(this.getDbPath(params))

        const dbName = path.basename(db.name)
        const logger = new Logger(`firepouch.restoreBackup(${dbName})::`)

        let collectionNames: string[] = []
        if (params?.collectionNames) {
            collectionNames = params.collectionNames
        } else {
            const meta = await db.meta.get()
            if (!meta) {
                throw new Error("firepouch.restoreBackup:: Cannot restore because db has no firepouch meta")
            }
            collectionNames = meta.collectionNames
        }

        if (params?.collectionNamesExclude) {
            collectionNames = collectionNames.filter(name => !params.collectionNamesExclude?.includes(name))
        }

        logger.log(`Found collections in backup:: ${JSON.stringify(collectionNames)}`)

        if (collectionNames.length) {
            const fns = collectionNames.map(name => {
                return () => this.restoreCollection(name, db, logger)
            })
            await promiseChain(fns)
        }

        await db.close()
        logger.log(`Finished restoring backup in ${new Date().getTime() - now.getTime()} ms`)
    }

    restoreFromArchive = async (params: RestoreArchiveParams) => {
        const zipPath = path.isAbsolute(params.path) ? params.path : path.resolve(process.cwd(), params.path)
        const extractedPath = await extractZip(zipPath)

        // use the extracted path to restore the backup
        await this.restoreBackup({
            name: extractedPath,
            collectionNames: params.collectionNames,
            collectionNamesExclude: params.collectionNamesExclude
        })

        // now delete the temp folder
        removeDir(extractedPath)
    }

    restoreBackupFromCloudStorage = async (params: BackupCloudStorageParams) => {
        const tempName = `restoreBackupFromCloudStorage-${nanoid()}`
        const zipFile = `${getTempFileName(tempName)}.zip`
        const storage = params.storage || this.app.storage()

        await storage.bucket().file(params.path).download({
            destination: zipFile
        })

        console.log("restoring", zipFile)
        await this.restoreFromArchive({ path: zipFile, collectionNames: params.collectionNames, collectionNamesExclude: params.collectionNamesExclude })
        await removeFile(zipFile)
    }

    dumpToJson = async (params?: DumpToJsonParams) => {
        const db = new FirestorePouchDb(this.getDbPath(params))
        const dest = params?.destination || path.resolve(db.name, `${path.basename(db.name)}.json`)
        await db.dumpToJson(dest)
    }
}
