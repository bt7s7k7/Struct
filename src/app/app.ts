import { Struct } from "../struct/Struct"
import { Type } from "../struct/TypeBuilder"

class Test extends Struct.define("Test", {
    name: Type.string,
    height: Type.string,
    nicknames: Type.string.as(Type.array),
    homes: Type.object({
        address: Type.string,
        doorSize: Type.number.as(Type.nullable)
    }).as(Type.record)
}) { }

// eslint-disable-next-line no-console
console.log(Test.definition)