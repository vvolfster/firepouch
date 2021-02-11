type acceptableFn = (params: any) => any | Promise<any>

export function promiseChain(promiseFns: acceptableFn[], startingParam?: any) {
    return new Promise((resolve, reject) => {
        let lastOutput: any = startingParam
        async function chain(idx = 0) {
            const fn = promiseFns[idx]
            if (!fn) {
                return resolve(lastOutput)
            } else {
                try {
                    lastOutput = await fn(lastOutput)
                    chain(idx + 1)
                } catch (e) {
                    reject(e)
                }
            }
        }
        chain()
    })
}
