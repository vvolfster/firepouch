export function wait(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

export function waitUntil(fn: () => boolean | Promise<boolean>, timeout?: number, interval?: number) {
    const i = interval || 100
    return new Promise<void>((resolve, reject) => {
        let timeWaited = 0
        const waiter = async (dontUpdateTimeWaited?: boolean) => {
            const result = await fn()
            if (result) {
                return resolve()
            } else if (!dontUpdateTimeWaited) {
                timeWaited += i
                if (timeout && timeWaited >= timeout) {
                    return reject(`Timeout of ${timeout} ms exceeded while waiting`)
                }
            }
            setTimeout(waiter, i)
        }
        waiter(true)
    })
}
