import axios from "axios"
import { MessageBridge } from "../dependencyInjection/commonServices/MessageBridge"
import { StructSyncMessages } from "../structSync/StructSyncMessages"

export class StructSyncAxios extends MessageBridge {
    public async sendMessage(message: MessageBridge.Message) {
        const structSyncMessage = message.data as StructSyncMessages.AnyControllerMessage

        const path = structSyncMessage.type == "action" ? `${structSyncMessage.target}/${structSyncMessage.action}`
            : structSyncMessage.type == "meta" ? `__meta::${structSyncMessage.name}`
                : structSyncMessage.target

        let body = structSyncMessage.type == "action" ? structSyncMessage.argument
            : structSyncMessage.type == "meta" ? structSyncMessage.data
                : null

        for (const key of Object.keys(structSyncMessage)) {
            if (body == null) body = {}

            if (key[0] == "_") {
                // @ts-ignore
                body[key] = structSyncMessage[key]
            }
        }

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

    public readonly url: string
    constructor(
        url: string
    ) {
        super()
        if (url[url.length - 1] != "/") url += "/"
        this.url = url
    }
}