import * as fs from "fs"
import archiver from "archiver"

export function archiveDirectory(dir: string, dest: string): Promise<string> {
    const output = fs.createWriteStream(dest)
    console.log("archiving directory", dir)

    const archive = archiver("zip", { zlib: { level: 0 } })
    return new Promise<string>((resolve, reject) => {
        output.on("error", reject)
        output.on("close", () => {
            const MB = (archive.pointer() / 1024 / 1024).toFixed(1)
            console.log(`Finished writing ${MB} mb to ${dest}`)
            resolve(dest)
        })

        archive.pipe(output)

        archive.directory(dir, "")
        archive.on("error", reject)

        archive.finalize()
    })
}
