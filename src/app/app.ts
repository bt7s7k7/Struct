/* eslint-disable no-console */
import { Struct } from "../struct/Struct"
import { Type } from "../struct/Type"

class Test extends Struct.define("Test", {
    name: Type.string,
    height: Type.number,
    nicknames: Type.string.as(Type.array),
    homes: Type.object({
        address: Type.string,
        doorSize: Type.number.as(Type.nullable)
    }).as(Type.record)
}) { }

console.log(Test.definition)
console.log(Test.default())
console.log(Test.default().serialize())

console.log(Test.deserialize({
    name: "",
    height: 0,
    nicknames: [],
    homes: {}
}))

class Deriv extends Struct.define("Deriv", {
    test: Test.ref()
}) { }

console.log(Deriv.deserialize(Deriv.default().serialize()))

type x = Struct.BaseType<typeof Test>