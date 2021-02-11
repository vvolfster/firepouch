import * as fs from "fs"

export function fileExists(file: string) {
    try {
        return fs.statSync(file).isFile()
    } catch (e) {
        return false
    }
}
