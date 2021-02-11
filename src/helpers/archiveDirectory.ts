import * as fs from "fs"
import archiver from "archiver"

function timer(fn: () => void) {
    setTimeout(() => {
        fn()
        timer(fn)
    }, 1000)
}

export function archiveDirectory(dir: string, dest: string) {
    const output = fs.createWriteStream(dest)
    console.log("archiving directory", dir)

    const archive = archiver("zip", { zlib: { level: 0 } })
    return new Promise<void>((resolve, reject) => {
        output.on("end", () => {
            console.log("data has been drained")
        })
        output.on("error", reject)
        output.on("close", () => {
            console.log(`Finished writing ${dest}`)
            resolve()
        })

        archive.pipe(output)

        archive.directory(dir, "./")
        archive.on("error", reject)

        timer(() => console.log(archive.pointer(), "bytes written"))

        archive.finalize()
    })
}
