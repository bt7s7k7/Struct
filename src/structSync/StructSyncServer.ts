import { DIService } from "../dependencyInjection/DIService"
import { StructController } from "./StructSyncContract"
import { StructSyncMessages } from "./StructSyncMessages"
import { StructSyncSession } from "./StructSyncSession"

export class StructSyncServer extends DIService.define() {
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

    public notifyMutation(mutation: StructSyncMessages.AnyMutateMessage) {
        this.sessions.forEach(v => v.notifyMutation(mutation))
    }

    public async sendMessage(controller: StructController, message: StructSyncMessages.AnyProxyMessage): Promise<void> {

    }

    public find(target: string): StructController {
        const controller = this.controllers[target]
        if (controller) return controller
        else throw new Error(`No controller named ${JSON.stringify(target)} found`)
    }

    protected controllers: Record<string, StructController> = {}
    protected sessions = new Set<StructSyncSession>()

    constructor() {
        super()
    }
}