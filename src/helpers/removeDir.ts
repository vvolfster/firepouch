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

export function removeFile(location: string) {
    if (!fs.existsSync(location)) {
        return
    }

    if (fs.lstatSync(location).isFile()) {
        fs.unlinkSync(location)
    } else {
        throw new Error(`${location} is not a file`)
    }
}
