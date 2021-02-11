import envPaths from "env-paths"
import mkdirp from "mkdirp"
import { nanoid } from "nanoid"
import * as path from "path"

export const getTempDir = (folder?: string) => {
    const tempPath = envPaths("firepouch").temp
    const dir = path.resolve(tempPath, folder || nanoid())
    mkdirp.sync(dir)
    return dir
}

export const getTempFileName = (fileName?: string) => {
    const tempPath = envPaths("firepouch").temp
    return path.resolve(tempPath, fileName || nanoid())
}
