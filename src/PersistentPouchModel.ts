import { notEmpty, wait } from "./helpers"
import { default as PouchDB } from "pouchdb"
import PouchDbFindPlugin from "pouchdb-find"
import { nanoid } from "nanoid"
import { reduce } from "lodash"

PouchDB.plugin(PouchDbFindPlugin)

export type BasePouchDbRecord<T> = PouchDB.Core.IdMeta & PouchDB.Core.GetMeta & { value: T }

export interface AllWithIds<T> {
    ids: string[]
    values: (T | undefined)[]
}

export interface AllWithIdsNoUndefined<T> {
    ids: string[]
    values: T[]
}

export interface AllDataMappedToId<T> {
    [key: string]: T | undefined
}

// This abstract class exists so that the compiler can accept these functions on both
// PersistentPouchDbModel<T> and ComputedPouchModel<T>
abstract class AbstractPouchModel<T> {
    abstract get(id: string): Promise<T | undefined>
    abstract getUndefinedOnNotFound(id: string): Promise<T | undefined>
    abstract getThrowOnNotFound(id: string): Promise<T>
    abstract all(): Promise<T[]>
    abstract allWithIds(): Promise<AllWithIds<T>>
    abstract allMappedToId(): Promise<AllDataMappedToId<T>>
    abstract allWithIdsNoUndefined(): Promise<AllWithIdsNoUndefined<T>>
    abstract bulkPut(ids: string[], values: T[]): Promise<void>
    abstract destroy(): Promise<void>
    abstract recreate(): Promise<void>
    abstract close(): Promise<void>
}

/* Descendants of this class live in persistent memory */
export class PersistentPouchDbModel<T> extends AbstractPouchModel<T> {
    db: PouchDB.Database
    name: string

    constructor(name: string) {
        super()
        this.name = name
        this.db = new PouchDB(name)
    }

    getDoc = async (id: string): Promise<undefined | BasePouchDbRecord<T>> => {
        try {
            const result: BasePouchDbRecord<T> = await this.db.get(id)
            return result
        } catch (e) {
            if (e.status === 404) {
                return undefined
            }
            throw e
        }
    }

    put = async (params: Pick<BasePouchDbRecord<T>, "_id" | "value">): Promise<BasePouchDbRecord<T>> => {
        const _id = params._id || nanoid()

        const existingDoc = await this.getDoc(_id)
        if (!existingDoc) {
            await this.db.put({
                _id,
                value: params.value
            })
            const newDoc = await this.getDoc(_id)
            if (!newDoc) {
                throw new Error(`Failed to create new record: ${JSON.stringify({ _id, value: params.value }, null, 4)}`)
            }

            return newDoc
        } else {
            existingDoc.value = params.value
            await this.db.put(existingDoc)
            return existingDoc
        }
    }

    remove = async (id: string): Promise<undefined | BasePouchDbRecord<T>> => {
        const doc = await this.getDoc(id)
        if (doc) {
            await this.db.remove(doc)
            return doc
        }
        return undefined
    }

    count = async () => {
        const info = await this.db.info()
        return info.doc_count
    }

    clear = async (): Promise<number> => {
        const allDocs = await this.db.allDocs({ include_docs: true })
        const deleteDocData = allDocs.rows.map(row => {
            return {
                _id: row.id,
                _rev: row.doc?._rev || "",
                _deleted: true
            }
        })

        await this.db.bulkDocs(deleteDocData)
        return allDocs.rows.length
    }

    // abstract methods defined here
    get = async (id: string): Promise<T | undefined> => {
        const result = await this.getDoc(id)
        return result?.value || undefined
    }
    getUndefinedOnNotFound = async (id: string) => this.get(id)
    getThrowOnNotFound = async (id: string): Promise<T> => {
        const result = await this.get(id)
        if (!result) {
            throw new Error(`Could not find ${this.name} with id: ${id}`)
        }
        return result
    }
    all = async (): Promise<T[]> => {
        const allDocs = await this.db.allDocs()
        const allValues = await Promise.all(allDocs.rows.map(row => this.get(row.id)))
        return allValues.filter(notEmpty)
    }
    allWithIds = async (): Promise<AllWithIds<T>> => {
        const allDocs = await this.db.allDocs()

        const ids = allDocs.rows.map(row => row.id)
        const values = await Promise.all(ids.map(id => this.get(id)))
        return {
            ids,
            values
        }
    }
    allMappedToId = async (): Promise<AllDataMappedToId<T>> => {
        const { ids, values } = await this.allWithIds()
        return reduce(
            ids,
            (acc: AllDataMappedToId<T>, id, idx) => {
                acc[id] = values[idx]
                return acc
            },
            {}
        )
    }

    allWithIdsNoUndefined = async (): Promise<AllWithIdsNoUndefined<T>> => {
        const allWithIds = await this.allWithIds()

        const ids: string[] = []
        const values: T[] = []

        allWithIds.values.forEach((value, idx) => {
            if (value === undefined || value === null) {
                return
            }
            const id = allWithIds.ids[idx]
            ids.push(id)
            values.push(value)
        })

        return { ids, values }
    }
    bulkPut = async (ids: string[], values: T[]) => {
        if (ids.length !== values.length) {
            throw new Error(`bulkUpdate called with mismatching number of ids ${ids.length} and values (${values.length})`)
        }

        if (!ids.length) {
            return
        }

        const allDocs = await this.db.allDocs({ include_docs: true })
        const idToRevMap = new Map<string, string>()
        allDocs.rows.forEach(row => {
            idToRevMap.set(row.id, row.doc?._rev || "")
        })

        const updatePayload = ids.map((_id, idx) => {
            const value = values[idx]
            const _rev = idToRevMap.get(_id)
            if (!_rev) {
                return {
                    _id,
                    value
                }
            } else {
                return {
                    _id,
                    value,
                    _rev
                }
            }
        })

        await this.db.bulkDocs(updatePayload)
    }
    destroy = () => this.db.destroy()

    recreate = async () => {
        await this.destroy()
        await wait(1) // waiting for next tick seems to work. wait(0) is somehow bad still
        this.db = new PouchDB(this.name)
    }

    close = () => this.db.close()
}

/* Descendants of this class are computed. Nothing is stored in persistent memory */
export abstract class ComputedCollectionModel<T> extends AbstractPouchModel<T> {
    collectionName: string
    protected rawPouch: PersistentPouchDbModel<T>

    constructor(collectionName: string, rawPouch: PersistentPouchDbModel<T>) {
        super()
        this.rawPouch = rawPouch
        this.collectionName = collectionName
    }

    // protected getWarnPrefix = (entry: Entry<any>) => {
    //     const msg = !space ? `in ${this.type} ${entry.sys.id}` : `in ${this.name} https://app.contentful.com/spaces/${space}/entries/${entry.sys.id}`
    //     return msg
    // }

    // // abstract methods defined here
    // all = async (): Promise<T[]> => {
    //     const docs = await this.rawPouch.db.allOfType(this.type)
    //     const results = await Promise.all(docs.map(d => this.getImpl(d)))
    //     return results.filter(notEmpty)
    // }

    // allWithIds = async (): Promise<AllWithIds<T>> => {
    //     await this.waitTillAvailable()
    //     const docs = await this.rawPouch.db.AllEntries.allOfType(this.type)
    //     const ids = docs.map(d => d.sys.id)
    //     const values = await Promise.all(docs.map(d => this.getImpl(d)))
    //     return { ids, values }
    // }

    // allWithIdsNoUndefined = async (): Promise<AllWithIdsNoUndefined<T>> => {
    //     const allWithIds = await this.allWithIds()

    //     const ids: string[] = []
    //     const values: T[] = []

    //     allWithIds.values.forEach((value, idx) => {
    //         if (value === undefined || value === null) {
    //             return
    //         }
    //         const id = allWithIds.ids[idx]
    //         ids.push(id)
    //         values.push(value)
    //     })

    //     return { ids, values }
    // }

    // allMappedToId = async (): Promise<AllDataMappedToId<T>> => {
    //     const { ids, values } = await this.allWithIds()
    //     return reduce(
    //         ids,
    //         (acc: AllDataMappedToId<T>, id, idx) => {
    //             acc[id] = values[idx]
    //             return acc
    //         },
    //         {}
    //     )
    // }

    // get = async (id: string): Promise<T | undefined> => {
    //     await this.waitTillAvailable()
    //     await this.validateIsSameType(id)
    //     const entry = await this.rawPouch.db.AllEntries.getOfType(id, this.type)
    //     if (!entry) {
    //         return undefined
    //     }

    //     const result = await this.getImpl(entry)
    //     return result
    // }
    // getUndefinedOnNotFound = async (id: string, warnPrefix?: string): Promise<T | undefined> => {
    //     await this.waitTillAvailable()
    //     try {
    //         await this.validateIsSameType(id)
    //     } catch (e) {
    //         if (RawContentfulSyncPouchStore.WarningLogger) {
    //             RawContentfulSyncPouchStore.WarningLogger([warnPrefix, "could not find", this.type, id].join(" "))
    //         } else {
    //             console.warn(warnPrefix, "not found", this.type, e)
    //         }

    //         return undefined
    //     }
    //     const entry = await this.rawPouch.db.AllEntries.getOfType(id, this.type)
    //     if (!entry) {
    //         return undefined
    //     }

    //     const result = await this.getImpl(entry)
    //     return result
    // }

    // getThrowOnNotFound = async (id: string): Promise<T> => {
    //     const result = await this.get(id)
    //     if (!result) {
    //         throw new Error(`Could not find ${this.type} with id: ${id}`)
    //     }
    //     return result
    // }

    // bulkPut = async (ids: string[], values: T[]) => {
    //     throw new Error(`${this.type} bulkPut does nothing on a in memory computed db - ${ids.length} ${values.length}`)
    // }

    // destroy = async () => {
    //     throw new Error(`${this.type} destroy does nothing on in a memory computed db`)
    // }

    // recreate = async () => {
    //     throw new Error(`${this.type} recreate does nothing on in a memory computed db`)
    // }

    // close = async () => {
    //     throw new Error(`${this.type} close does nothing on in a memory computed db`)
    // }
}
