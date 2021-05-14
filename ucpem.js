/// <reference path="./.vscode/config.d.ts" />

const { project, github } = require("ucpem")

const struct = project.prefix("src").res("struct")

project.prefix("src").res("structSync",
    struct,
    github("bt7s7k7/DependencyInjection").res("dependencyInjection")
)

project.prefix("test").use(github("bt7s7k7/TestUtil").res("testUtil"))
