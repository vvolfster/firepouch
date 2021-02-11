import * as fs from "fs"
import rimraf from "rimraf"

export function removeDir(dir: string) {
    if (!fs.existsSync(dir)) {
        return
    }

    try {
        rimraf.sync(dir)
    } catch (e) {
        throw e
    }
}
