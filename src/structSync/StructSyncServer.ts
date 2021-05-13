import { MessageBridge } from "../dependencyInjection/commonServices/MessageBridge"
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

    protected messageBridge = this.context.inject(MessageBridge)
    protected controllers: Record<string, StructController> = {}

    constructor() {
        super()

        this.messageBridge.onRequest.add(this, msg => {
            if (msg.type == "StructSync:controller_message") {
                msg.handle(async (msg: StructSyncMessages.AnyControllerMessage) => {
                    if (msg.type == "find") {
                        const controller = this.controllers[msg.target]
                        if (controller) return controller.serialize()
                        else throw new Error(`No controller named ${JSON.stringify(msg.target)} found`)
                    } else if (msg.type == "action") {
                        const controller = this.controllers[msg.target]
                        if (controller) {
                            return controller.runAction(msg.action, msg.argument)
                        }
                        else throw new Error(`No controller named ${JSON.stringify(msg.target)} found`)
                    } else throw new Error(`Unknown msg type ${JSON.stringify((msg as any).type)}`)
                })
            }
        })
    }
}