import { MessageBridge } from "../dependencyInjection/commonServices/MessageBridge"
import { DIContext } from "../dependencyInjection/DIContext"
import { DIService } from "../dependencyInjection/DIService"
import { StructProxy } from "./StructSyncContract"
import { StructSyncMessages } from "./StructSyncMessages"

export class StructSyncClient extends DIService.define() {
    public register(controller: StructProxy) {

    }

    public unregister(controller: StructProxy) {

    }

    public async find(context: DIContext, name: string, ctor: any, track: boolean) {
        const data = await this.sendMessage({
            type: "find",
            target: name,
            track
        })

        const proxy = context.instantiate(() => ctor.deserialize(data))

        if (track) this.register(proxy)

        return proxy
    }

    public async runAction(target: string, action: string, argument: any) {
        return this.sendMessage({
            type: "action",
            action, argument, target
        })
    }

    public sendMessage(message: StructSyncMessages.AnyControllerMessage) {
        return this.messageBridge.sendRequest("StructSync:controller_message", message)
    }

    protected messageBridge = this.context.inject(MessageBridge)

    constructor() {
        super()
    }
}