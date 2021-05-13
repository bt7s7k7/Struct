import { MessageBridge } from "../dependencyInjection/commonServices/MessageBridge"
import { DIContext } from "../dependencyInjection/DIContext"
import { EventListener } from "../eventLib/EventListener"
import { StructController } from "./StructSyncContract"
import { StructSyncMessages } from "./StructSyncMessages"
import { StructSyncServer } from "./StructSyncServer"

export class StructSyncSession extends EventListener {
    public readonly server = DIContext.current.inject(StructSyncServer)
    protected tracked = new Set<StructController>()

    constructor(
        public readonly messageBridge: MessageBridge
    ) {
        super()

        this.messageBridge.onRequest.add(this, msg => {
            if (msg.type == "StructSync:controller_message") {
                msg.handle(async (msg: StructSyncMessages.AnyControllerMessage) => {
                    if (msg.type == "find") {
                        const controller = this.server.find(msg.target)
                        if (msg.track) this.tracked.add(controller)
                        return controller.serialize()
                    } else if (msg.type == "action") {
                        this.server.find(msg.target).runAction(msg.action, msg.argument)
                    } else throw new Error(`Unknown msg type ${JSON.stringify((msg as any).type)}`)
                })
            }
        })
    }
}
