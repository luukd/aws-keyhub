#!/usr/bin/env node

// Licensed to the Apache Software Foundation (ASF) under one or more
// contributor license agreements.  See the NOTICE file distributed with
// this work for additional information regarding copyright ownership.
// The ASF licenses this file to You under the Apache License, Version 2.0
// (the "License"); you may not use this file except in compliance with
// the License.  You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
// 
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

const program = require('commander');
const packagejson = require('./package.json');

(async () => {
    program
        .version(packagejson.version)
        .option('-c, --configure', 'Configure KeyHub url and credentials.')
        .option('-r, --role-arn [role]', 'Automatically continue log-in with specified role ARN.')
        .parse(process.argv);

    if (program.configure) {
        await require('./src/configure.js').configure();
    } else {
        let options = {};
        if (program.roleArn) {
            options.roleArn = program.roleArn;
        }
        require('./src/login.js').login(options);
    }

})();