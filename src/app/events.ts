import { Struct } from "../struct/Struct"
import { Type } from "../struct/Type"
import { ActionType } from "../structSync/ActionType"
import { EventType } from "../structSync/EventType"
import { StructSyncContract } from "../structSync/StructSyncContract"

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

controller.onValue.emit("Hello world!")