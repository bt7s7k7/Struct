import { DIService } from "../dependencyInjection/DIService"
import { StructController } from "./StructSyncContract"
import { StructSyncMessages } from "./StructSyncMessages"

export class StructSyncServer extends DIService.define() {
    public register(name: string, controller: StructController) {
        if (!(name in this.controllers)) this.controllers[name] = controller
        else throw new Error(`Controller named ${JSON.stringify(name)} registered already`)
    }

    public unregister(name: string) {
        delete this.controllers[name]
    }

    public async sendMessage(controller: StructController, message: StructSyncMessages.AnyProxyMessage): Promise<void> {

    }

    public find(target: string): StructController {
        const controller = this.controllers[target]
        if (controller) return controller
        else throw new Error(`No controller named ${JSON.stringify(target)} found`)
    }

    protected controllers: Record<string, StructController> = {}

    constructor() {
        super()
    }
}