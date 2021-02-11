import * as fs from "fs"
import { every, groupBy, isArray, isNumber, isString, last } from "lodash"
import * as path from "path"
import { notEmpty } from "./helpers"
import { PersistentPouchDbModel } from "./PersistentPouchModel"

export const FIRE_POUCH_META_ID = "firepouch-meta"

const DB_INDEXES = {
    COLLECTION_NAME: "value.collectionName"
}

export interface FirestorePouchMeta {
    id: string
    collectionNames: string[]
    dateCreatedMs: number
}

export interface FirestorePouchDocument {
    id: string
    collectionName: string
    data: FirebaseFirestore.DocumentData
}

export interface FireStorePaginatedCollection {
    values: FirestorePouchDocument[]
    next: undefined | (() => Promise<FireStorePaginatedCollection>)
}

function isFirestorePouchMeta(obj: any): obj is FirestorePouchMeta {
    return obj && obj.id === FIRE_POUCH_META_ID && isNumber(obj.dateCreatedMs) && isArray(obj.collectionNames) && every(obj.collectionNames, isString)
}

function isFirestorePouchDocument(obj: any): obj is FirestorePouchDocument {
    return obj && !isFirestorePouchMeta(obj)
}

export class FirestorePouchDb extends PersistentPouchDbModel<FirestorePouchDocument | FirestorePouchMeta> {
    constructor(name: string) {
        super(name)
        this.db.createIndex({
            index: {
                fields: [DB_INDEXES.COLLECTION_NAME]
            }
        })
    }

    meta = {
        set: (meta: Omit<FirestorePouchMeta, "id">) => {
            return this.put({
                _id: FIRE_POUCH_META_ID,
                value: {
                    ...meta,
                    id: FIRE_POUCH_META_ID
                }
            })
        },
        get: async (): Promise<FirestorePouchMeta | undefined> => {
            const result = await this.get(FIRE_POUCH_META_ID)
            if (!result || !isFirestorePouchMeta(result)) {
                return undefined
            }
            return result
        }
    }

    dumpToJson = async (jsonPath?: string) => {
        const startTime = new Date().getTime()
        const prettyName = [last(this.name.split(path.sep)) || "dump", ".json"].join("")
        const filePath = jsonPath || path.resolve(process.cwd(), prettyName)
        console.log(`Creating json dump at ${filePath}...`)

        const allDocsAndMeta = await this.all()
        const dump: any = groupBy(allDocsAndMeta, "collectionName")
        delete dump.undefined

        const meta = await this.meta.get()
        if (meta) {
            dump.meta = [meta]
        }

        fs.writeFileSync(filePath, JSON.stringify(dump, null, 2))
        console.log(`Finished json dump at ${filePath} in ${new Date().getTime() - startTime} ms`)
    }

    collectionCursor = async (collectionName: string, limit: number, skip?: number): Promise<FireStorePaginatedCollection> => {
        const rawResults = await this.db.find({
            selector: {
                [DB_INDEXES.COLLECTION_NAME]: collectionName
            },
            limit,
            skip
        })

        if (!rawResults.docs.length) {
            return {
                values: [],
                next: undefined
            }
        }

        const results = await Promise.all(rawResults.docs.filter(notEmpty).map(d => this.get(d._id)))
        const values = results.filter(isFirestorePouchDocument)
        return {
            values,
            next: () => this.collectionCursor(collectionName, limit, (skip || 0) + rawResults.docs.length)
        }
    }

    collectionCursorForEach = async (collectionName: string, limit: number, fn: (values: FirestorePouchDocument[]) => any | Promise<any>): Promise<number> => {
        return new Promise<number>((resolve, reject) => {
            let count = 0
            const advanceCursor = async (cursor?: FireStorePaginatedCollection) => {
                try {
                    if (!cursor) {
                        cursor = await this.collectionCursor(collectionName, limit)
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
}
