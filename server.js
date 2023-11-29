const sql = require('mssql')
var http = require('http')
var querystring = require('querystring')
var SqlString = require('sqlstring')
var fs = require('fs')
const { argv } = require('process')

const USER = argv[2]
const PASSWORD = argv[3]
const SERVER = argv[4]

const sqlConfig = {
    user: USER,
    password: PASSWORD,
    database: 'CF_SA_GAME',
    server: SERVER,
    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
    },
    options: {
        encrypt: false, // for azure
        trustServerCertificate: true // change to true for local dev / self-signed certs
    }
}

// Query user's usn
async function queryUSN(user_id) {
    try {
        await sql.connect(sqlConfig)
        result = await sql.query(SqlString.format('use CF_SA_GAME;select * from CF_MEMBER where LUSER_ID = ?', [user_id]))
        return result
    } catch (err) {
        console.log(err)
    }
}

async function addCurrency(usn, amount) {
    try {
        await sql.connect(sqlConfig)
        result = await sql.query(SqlString.format('DECLARE @return_value int;' +
            'use CF_SA_WEB_DB;' +
            'exec @return_value = WSP_GIVE_CURRENCY @p_USN = ?, @p_GiveUSN = ?, @p_Type = N\'C\', @p_Ammount = ?, @p_Result = 0;' +
            'SELECT	\'rtn\' = @return_value', [usn, usn, amount]))
        return result
    } catch (err) {
        console.log(err)
    }
}

async function registerUser(user_id, password, email) {
    try {
        await sql.connect(sqlConfig)
        result = await sql.query(SqlString.format('use CF_SA_GAME;' +
            'exec PROC_WEB_USER_INFO_INS @p_User_id = ?,' +
            '@p_User_pass = ?,' +
            '@p_Mail = ?,' +
            '@p_Result = 0'), [user_id, password, email])
        return result
    } catch (err) {
        console.log(err)
    }
}

async function fixInventory(usn) {
    try {
        await sql.connect(sqlConfig)
        result = await sql.query(SqlString.format('use CF_SA_GAME;delete from CF_USER_INVENTORY where ITEM_CODE = \'I5001\' and USN = ?', [usn]))
        return result
    } catch (err) {
        console.log(err)
    }
}

function responseClient(response, code = 200, type = 'text/plain', msg) {
    response.writeHead(code, { 'Content-Type': type + ';charset=utf-8' });
    response.write(msg)
    response.end()
}

http.createServer(function (request, response) {
    var post = ''
    switch (request.url) {
        case '/addCurrency':
            request.on('data', (chunk) => {
                post += chunk
            })
            request.on('end', () => {
                post = querystring.parse(post);
                if (post.user_id && post.amount) {
                    const amountInt = Number(post.amount)
                    if (isNaN(amountInt)) {
                        responseClient(response, 200, 'text/plain', '看不懂文字？')
                        return
                    }
                    if (amountInt <= 0) {
                        responseClient(response, 200, 'text/plain', '负数你充你马呢？')
                        return
                    }
                    const pattern = /[^0-9a-zA-Z]+/g
                    if (pattern.test(post.user_id)) {
                        responseClient(response, 403, 'text/plain', '账号名只能包含英文字母和数字')
                        return
                    }
                    queryUSN(post.user_id).then((result) => { // Add current
                        if (!result['rowsAffected'][0]) {
                            responseClient(response, 403, 'text/plain', '用户不存在')
                            return;
                        }
                        const usn = result['recordset'][0]['USN']
                        addCurrency(usn, post.amount).then((result) => {
                            if (result['recordset'][0]['rtn'] == 0) {
                                console.log(post.user_id + " " + post.amount)
                                responseClient(response, 200, 'text/plain', '充值成功')
                            } else {
                                responseClient(response, 403, 'text/plain', '充值失败')
                            }
                        }).catch(() => {
                            responseClient(response, 403, 'text/plain', '连接数据库失败')
                        })
                    }).catch(() => {
                        responseClient(response, 403, 'text/plain', '连接数据库失败')
                    })
                } else {
                    responseClient(response, 200, 'text/html', fs.readFileSync('addCurrency.html').toString())
                }
            })
            break
        case '/register':
            request.on('data', (chunk) => {
                post += chunk
            })
            request.on('end', () => {
                post = querystring.parse(post);
                if (post.user_id) {
                    if (!post.password) {
                        responseClient(response, 403, 'text/plain', '请输入密码')
                        return
                    }
                    if (!post.email) {
                        responseClient(response, 403, 'text/plain', '请输入邮箱')
                        return
                    }
                    const idPattern = /[^0-9a-zA-Z]+/g
                    if (idPattern.test(post.user_id)) {
                        responseClient(response, 403, 'text/plain', '账号名只能包含英文字母和数字')
                        return
                    }
                    const emPattern = /^[a-zA-Z0-9_-]+@[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)+$/
                    if (!emPattern.test(post.email)) {
                        responseClient(response, 403, 'text/plain', '请输入正确的邮箱')
                        return
                    }
                    const pwdPattern = /^([a-zA-Z]+[0-9]+[,._!@#$%^&*]+)|([a-zA-Z]+[,._!@#$%^&*]+[0-9]+)|([0-9]+[,._!@#$%^&*]+[a-zA-Z]+)|([0-9]+[a-zA-Z]+[,._!@#$%^&*]+)|([,._!@#$%^&*]+[a-zA-Z]+[0-9]+)|([,._!@#$%^&*]+[0-9]+[a-zA-Z]+)$/
                    if (!pwdPattern.test(post.password)) {
                        responseClient(response, 403, 'text/plain', '密码太简单\n密码必须包含数字、字母和特殊符号')
                        return
                    }
                    registerUser(post.user_id, post.password, post.email).then((result) => {
                        responseClient(response, 200, 'text/plain', '注册成功')
                    }).catch(() => {
                        responseClient(response, 403, 'text/plain', '连接数据库失败')
                    })
                } else {

                    responseClient(response, 200, 'text/html', fs.readFileSync('register.html').toString())
                }
            })
            break
        case '/fix':
            request.on('data', (chunk) => {
                post += chunk
            })
            request.on('end', () => {
                post = querystring.parse(post);
                if (post.user_id) {
                    const idPattern = /[^0-9a-zA-Z]+/g
                    if (idPattern.test(post.user_id)) {
                        responseClient(response, 403, 'text/plain', '账号名只能包含英文字母和数字')
                        return
                    }
                    queryUSN(post.user_id).then((result) => {
                        if (!result['rowsAffected'][0]) {
                            responseClient(response, 403, 'text/plain', '用户不存在')
                            return;
                        }
                        const usn = result['recordset'][0]['USN']
                        fixInventory(usn).then(() => {
                            responseClient(response, 200, 'text/plain', '背包修复成功')
                        })
                    })
                } else {
                    responseClient(response, 200, 'text/html', fs.readFileSync('fix.html').toString())
                }
            })
            break
        default:
            response.writeHead(404, { 'Content-Type': 'text/plain' });
            response.end('404 Not Found');
    }
}).listen(8888);