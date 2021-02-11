# firepouch
Import and export firestore to/from a pouchdb

### Why use this tool and why use pouchdb?
There are other tools that let you backup firestore but they seem to download your entire firestore into memory. This is problematic because it is very easy to run out of heap memory during the backup
process on a firestore instance with lots of documents and collections.

### Disclaimer
This tool currently does not support:
- subcollections
- document references
- geopoint, firestore date data

These might be added later if there's enough people wanting these features. I didn't use them for my firestore instance so I decided to skip them for now.

### Usage

#### Create backup
```javascript
const admin = require("firebase-admin")
const { Firepouch } = require("firepouch")

function getAdminApp() {
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
    await firepouch.createBackup({ name })
}

start()
```

#### Restore backup
```javascript
const admin = require("firebase-admin")
const { Firepouch } = require("firepouch")

function getAdminApp() {
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
    await firepouch.restoreBackup({ name })
}

start()
```