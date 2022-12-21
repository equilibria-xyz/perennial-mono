import '@nomiclabs/hardhat-ethers'
import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types'
import { IOracleProvider, IOracleProvider__factory } from '../types/generated'

function asString(oracleVersion: IOracleProvider.OracleVersionStructOutput) {
  return JSON.stringify(
    {
      price: oracleVersion.price.toString(),
      timestamp: oracleVersion.timestamp.toString(),
      version: oracleVersion.version.toString(),
    },
    null,
    2,
  )
}

function equal(a: IOracleProvider.OracleVersionStructOutput, b: IOracleProvider.OracleVersionStructOutput) {
  return a.timestamp.eq(b.timestamp) && a.price.eq(b.price) && a.version.eq(b.version)
}

export default task('compareOracleVersions', 'Compares all versions for two oracles, starting from latest to 0')
  .addPositionalParam('a', 'Oracle 1 to query')
  .addPositionalParam('b', 'Oracle 2 to query')
  .setAction(async (args: TaskArguments, HRE: HardhatRuntimeEnvironment) => {
    const { ethers } = HRE
    const [signer] = await ethers.getSigners()
    const oracle1 = await IOracleProvider__factory.connect(args.a, signer)
    const oracle2 = await IOracleProvider__factory.connect(args.b, signer)

    const oracle1Latest = await oracle1.callStatic.currentVersion()
    const oracle2Latest = await oracle2.callStatic.currentVersion()
    const maxVersion = Math.max(oracle1Latest.version.toNumber(), oracle2Latest.version.toNumber())

    console.log(`Starting at Oracle Version: ${maxVersion}`)
    for (let i = maxVersion; i >= 0; i--) {
      const [a, b] = await Promise.all([oracle1.callStatic.atVersion(i), oracle2.callStatic.atVersion(i)])
      if (!equal(a, b)) {
        console.log('Found Difference:')
        console.log(asString(a), asString(b))
      }
    }

    console.log('Done.')
  })
