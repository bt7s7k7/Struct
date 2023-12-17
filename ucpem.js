/// <reference path="./.vscode/config.d.ts" />

const { project, github } = require("ucpem")

const struct = project.prefix("src").res("struct")

const structSync = project.prefix("src").res("structSync",
    struct,
    github("bt7s7k7/DependencyInjection").res("dependencyInjection")
)

project.prefix("src").res("structRPC",
    struct,
    github("bt7s7k7/DependencyInjection").res("dependencyInjection")
)

const structSyncExpress = project.prefix("src").res("structSyncExpress", structSync)
const structSyncAxios = project.prefix("src").res("structSyncAxios", structSync)

project.prefix("test").use(github("bt7s7k7/TestUtil").res("testUtil"))
