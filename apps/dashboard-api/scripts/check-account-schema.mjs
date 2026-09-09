import { checkAccountSchema } from '../src/lib/check-account-schema.js'

const report = await checkAccountSchema()
console.log(JSON.stringify(report))
if (report.status !== 'READY') process.exitCode = 1
