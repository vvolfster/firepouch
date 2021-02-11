import * as path from "path"
import * as fs from "fs"

export function filesInDirectory(dir: string, recursive = true, acc: string[] = []) {
    try {
        const files = fs.readdirSync(dir)
        for (const i in files) {
            const name = [dir, files[i]].join(path.sep)
            if (fs.statSync(name).isDirectory()) {
                if (recursive) {
                    filesInDirectory(name, recursive, acc)
                }
            } else {
                acc.push(name)
            }
        }
        return acc
    } catch (e) {
        return acc
    }
}
