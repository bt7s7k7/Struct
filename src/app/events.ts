/* eslint-disable no-console */
import { IDProvider } from "../dependencyInjection/commonServices/IDProvider"
import { MessageBridge } from "../dependencyInjection/commonServices/MessageBridge"
import { DIContext } from "../dependencyInjection/DIContext"
import { Struct } from "../struct/Struct"
import { Type } from "../struct/Type"
import { ActionType } from "../structSync/ActionType"
import { EventType } from "../structSync/EventType"
import { StructSyncClient } from "../structSync/StructSyncClient"
import { StructSyncContract } from "../structSync/StructSyncContract"
import { StructSyncServer } from "../structSync/StructSyncServer"
import { StructSyncSession } from "../structSync/StructSyncSession"

void (async () => {
    const context = new DIContext()

    context.provide(IDProvider, () => new IDProvider.Incremental())
    context.provide(MessageBridge, () => new MessageBridge.Dummy())
    context.provide(StructSyncClient, "default")
    context.provide(StructSyncServer, "default")

    context.instantiate(() => new StructSyncSession(context.inject(MessageBridge)))

    class Foo extends Struct.define("Foo", {}) { }

    const FooContract = StructSyncContract.define(Foo, {
        emitValue: ActionType.define("emitValue", Type.string, Type.empty)
    }, {
        onValue: EventType.define("onValue", Type.string)
    })

    class FooProxy extends FooContract.defineProxy() { }
    class FooController extends FooContract.defineController() {

    }

    const controller = new FooController({})

    context.instantiate(() => controller.register())

    const proxy = await FooProxy.make(context)

    proxy.onValue.add(null, (value) => {
        console.log("Received event:", [value])
    })

    controller.onValue.emit("Hello world!")
})().catch(err => console.error(err))