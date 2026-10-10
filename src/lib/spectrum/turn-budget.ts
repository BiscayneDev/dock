/** Reserve time for an honest reply before the webhook's 120-second limit. */
export const TURN_WORK_MS = 85_000
export const TURN_DEADLINE_REPLY = 'This run hit its time limit before I finished the request. If it included a change or send, check whether it went through before retrying.'

export class TurnDeadlineExceeded extends Error {
    constructor() { super('turn deadline exceeded'); this.name = 'TurnDeadlineExceeded' }
}

export async function withinTurn<T>(deadlineAt: number | undefined, work: (signal?: AbortSignal) => Promise<T>): Promise<T> {
    if (deadlineAt === undefined) return work()
    const remaining = deadlineAt - Date.now()
    if (remaining <= 0) throw new TurnDeadlineExceeded()
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
        return await Promise.race([
            Promise.resolve().then(() => work(controller.signal)),
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => {
                    reject(new TurnDeadlineExceeded())
                    controller.abort()
                }, remaining)
            }),
        ])
    } finally {
        if (timer) clearTimeout(timer)
    }
}
