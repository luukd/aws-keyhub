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

const constants = require.main.require('./constants.js');

const puppeteer = require('puppeteer');
const inquirer = require('inquirer');
const configure = require('./configure.js');
const saml = require('./utils/SamlUtil.js');
const AwsCliUtil = require('./utils/AwsCliUtil.js');
let samlPayloadIntercepted = false;

module.exports = {

    login: async function (options) {
        try {
            await configure.hasValidConfiguration();
            await AwsCliUtil.checkIfConfigFileExists();
        } catch (error) {
            console.error(error.message);
            process.exit(1);
        }

        const browser = await puppeteer.launch({
            userDataDir: constants.PATHS.AWS_KEYHUB.PUPPETEER_PROFILE
        });

        let page;

        try {
            page = await browser.newPage();
            page.setDefaultNavigationTimeout(15000);

            await page.setRequestInterception(true);
            page.on('request', async (interceptedRequest) => {
                try {
                    await interceptSamlPayloadForAWS(interceptedRequest, page, browser, options.roleArn);
                } catch (error) {
                    console.error(error.message);
                    process.exit(1);
                }
            });

            await openKeyHub(page, configure.getUrl());
            await new Promise((resolve) => setTimeout(() => resolve(), 1000));

            if (samlPayloadIntercepted === false) {
                if (await doesUsernameFieldExist(page))
                    await fillInUsernameField(page, configure.getUsername());
                if (await doesPasswordFieldExist(page))
                    await fillInPasswordField(page, await configure.getPassword());
                await askAndFillVerificationCodeIfFieldExists(page);
            }
        } catch (error) {
            console.error(error);
            await exit(browser, page);
        }
    }

};

async function openKeyHub(page, keyHubUrl) {
    try {
        await page.goto(keyHubUrl);
    } catch (error) {
        throw new Error('Opening KeyHub at ' + keyHubUrl + ' failed.');
    }
}

async function doesFieldExist(page, selector) {
    if (await page.$(selector) !== null) {
        return true;
    } else {
        return false
    }
}

async function doesUsernameFieldExist(page) {
    return await doesFieldExist(page, 'input[name="username"]');
}

async function doesPasswordFieldExist(page) {
    return await doesFieldExist(page, 'input[name="password"]');
}

async function fillInUsernameField(page, username) {
    const usernameSelector = 'input[name="username"]';
    await page.type(usernameSelector, username);
    await Promise.all([page.click('a.button-action'), page.waitForNavigation()]);
}

async function fillInPasswordField(page, password) {
    const passwordSelector = 'input[name="password"]';
    await page.type(passwordSelector, password);
    await Promise.all([page.click('a.button-action'), page.waitForNavigation()]);
}

async function askAndFillVerificationCodeIfFieldExists(page) {
    const verificationCodeSelector = 'input[name="token"]';
    if (await page.$(verificationCodeSelector) !== null) {
        const verificationCode = await inquirer.prompt([
            {
                type: 'password',
                name: 'verificationCode',
                message: "KeyHub verification code (2FA)"
            }
        ]);

        // Check for entered verification code. If the KeyHub app push notification is 
        // used for 2FA this path is skipped.
        if (verificationCode.verificationCode.length > 5) {
            await page.type(verificationCodeSelector, verificationCode.verificationCode);
            await Promise.all([page.click('a.button-action'), page.waitForNavigation()]);
            // TODO: handle invalid verification code entered response
        }
    } else {
        throw new Error('verification code field not found');
    }
}

async function interceptSamlPayloadForAWS(interceptedRequest, page, browser, preselectedRoleArn) {
    if (interceptedRequest._url === 'https://signin.aws.amazon.com/saml') {
        samlPayloadIntercepted = true;

        const samlResponse = saml.getSamlResponse(interceptedRequest);
        const samlResponseBase64 = saml.getBase64SamlResponse(samlResponse);
        const samlResponseDecoded = saml.getDecodedSamlResponse(samlResponseBase64);
        const rolesAndPrincipals = saml.getRolesAndPrincipalsFromSamlResponse(samlResponseDecoded);

        const selectedRoleAndPrincipal = await selectAwsRole(rolesAndPrincipals, preselectedRoleArn);

        if (selectedRoleAndPrincipal === undefined) {
            throw new Error('Invalid role ARN provided, could not log in.');
        }

        await AwsCliUtil.configureWithSamlAssertion(selectedRoleAndPrincipal.role, selectedRoleAndPrincipal.principal, samlResponseBase64, configure.getAssumeDuration());
        console.log('Successfully logged in, use the profile `keyhub`. (export AWS_PROFILE=keyhub / set AWS_PROFILE=keyhub)');

        await interceptedRequest.abort();
        await exit(browser, page);

    } else {
        await interceptedRequest.continue();
    }
}

async function selectAwsRole(rolesAndPrincipals, preselectedRoleArn) {
    let selectedRole;
    if (preselectedRoleArn !== undefined) {
        selectedRole = preselectedRoleArn;
    } else {
        selectedRole = (await askUserForAwsRole(rolesAndPrincipals)).selectedRole;
    }

    let selectedRoleAndPrincipal;
    rolesAndPrincipals.some((roleAndPrincipal) => {
        if (roleAndPrincipal.role === selectedRole) {
            return selectedRoleAndPrincipal = roleAndPrincipal;
        }
    });

    return selectedRoleAndPrincipal;
}

async function askUserForAwsRole(rolesAndPrincipals) {
    return inquirer.prompt([
        {
            type: 'rawlist',
            name: 'selectedRole',
            message: 'Choose a role:',
            choices: () => {
                return rolesAndPrincipals.map(entry => {
                    return {name: entry.role + ' / ' + entry.description, value: entry.role};
                });
            }
        }
    ]);
}

async function exit(browser, page) {
    if (page && !page.isClosed()) {
        await page.close();
    }
    await browser.close();
    process.exit();
}