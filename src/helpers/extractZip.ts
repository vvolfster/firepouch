import ez from "extract-zip"
import { fileExists } from "./fileExists"
import { getTempDir } from "./getTempDir"

export const extractZip = async (zipPath: string): Promise<string> => {
    if (!fileExists(zipPath)) {
        throw new Error(`File ${zipPath} does not exist`)
    }

    const dir = getTempDir()
    console.log("extracting", zipPath, "to temp dir", dir)
    await ez(zipPath, { dir })
    return dir
}
