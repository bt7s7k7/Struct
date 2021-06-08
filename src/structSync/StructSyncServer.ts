import { DIService } from "../dependencyInjection/DIService"
import { DISPOSE } from "../eventLib/Disposable"
import { EventListener } from "../eventLib/EventListener"
import { StructController } from "./StructSyncContract"
import { StructSyncMessages } from "./StructSyncMessages"
import { StructSyncSession } from "./StructSyncSession"

export class StructSyncServer extends DIService.define() {
    public middleware: StructSyncServer.Middleware[] = []

    public [DISPOSE]() {
        super[DISPOSE]()

        this.middleware.forEach(v => v.dispose())
    }

    public register(name: string, controller: StructController) {
        if (!(name in this.controllers)) this.controllers[name] = controller
        else throw new Error(`Controller named ${JSON.stringify(name)} registered already`)
    }

    public unregister(name: string) {
        delete this.controllers[name]
    }

    public attachSession(session: StructSyncSession, remove?: "remove") {
        if (remove) this.sessions.delete(session)
        else this.sessions.add(session)
    }

    public async notifyMutation(mutation: StructSyncMessages.AnyMutateMessage) {
        for (const session of this.sessions) {
            await session.notifyMutation(mutation)
        }
    }

    public async emitEvent(event: StructSyncMessages.EventMessage) {
        for (const session of this.sessions) {
            await session.emitEvent(event)
        }
    }

    public find(target: string): StructController {
        const controller = this.controllers[target]
        if (controller) return controller
        else throw new Error(`No controller named ${JSON.stringify(target)} found`)
    }

    public use(middleware: StructSyncServer.Middleware) {
        this.middleware.push(middleware)
    }

    protected controllers: Record<string, StructController> = {}
    protected sessions = new Set<StructSyncSession>()

    constructor() {
        super()
    }
}

export namespace StructSyncServer {
    export class Middleware extends EventListener {
        constructor(
            public readonly options: MiddlewareOptions
        ) {
            super()
        }
    }

    export interface MiddlewareOptions {
        onIncoming?: (server: StructSyncServer, session: StructSyncSession, msg: StructSyncMessages.AnyControllerMessage) => Promise<any>
        onOutgoing?: (server: StructSyncServer, session: StructSyncSession, msg: StructSyncMessages.AnyProxyMessage) => Promise<StructSyncMessages.AnyProxyMessage | void>
    }
}