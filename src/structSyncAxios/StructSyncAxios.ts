import axios from "axios"
import { MessageBridge } from "../dependencyInjection/commonServices/MessageBridge"
import { StructSyncMessages } from "../structSync/StructSyncMessages"

export class StructSyncAxios extends MessageBridge {
    public async sendMessage(message: MessageBridge.Message) {
        const structSyncMessage = message.data as StructSyncMessages.AnyControllerMessage
        const path = structSyncMessage.type == "action" ? `${structSyncMessage.target}/${structSyncMessage.action}` : structSyncMessage.target
        const body = structSyncMessage.type == "action" ? structSyncMessage.argument : null

        const response = await axios.post(this.url + path, body)

        if (response.status == 200) {
            this.onMessage.emit({
                direction: "response",
                id: message.id,
                data: response.data,
                error: null
            })
        } else {
            this.onMessage.emit({
                direction: "response",
                id: message.id,
                data: null,
                error: response.data
            })
        }
    }

    constructor(
        public readonly url: string
    ) { super() }
}