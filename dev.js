const dotenv = require("dotenv")
const admin = require("firebase-admin")
const { Firepouch } = require("./dist")

function getAdminApp() {
    dotenv.config()
    const { CLIENT_EMAIL, PROJECT_ID, PRIVATE_KEY, DATABASE_URL, STORAGE_BUCKET } = process.env
    const serviceAccount = {
        clientEmail: CLIENT_EMAIL,
        projectId: PROJECT_ID,
        privateKey: (PRIVATE_KEY || "").replace(/\\n/g, "\n")
    }

    const adminApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: DATABASE_URL,
        storageBucket: STORAGE_BUCKET
    })
    return adminApp
}

async function start() {
    const name = "my-backup"
    const firepouch = new Firepouch({ app: getAdminApp() })
    // await firepouch.createBackup({ name })
    await firepouch.createBackupToArchive({ name })
    // await firepouch.dumpToJson({ name })
    // await firepouch.restoreBackup({ name })
}

start()
