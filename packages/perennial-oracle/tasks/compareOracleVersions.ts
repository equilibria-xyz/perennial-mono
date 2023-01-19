import '@nomiclabs/hardhat-ethers'
import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types'
import { BigNumber } from 'ethers'

// Because of a circular dependency with Hardhat and Typechain, we need to re-declare this struct instead
// of importing from generated typechain types.
type OracleVersionStruct = {
  version: BigNumber
  timestamp: BigNumber
  price: BigNumber
}

function asString(oracleVersion: OracleVersionStruct) {
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

function equal(a: OracleVersionStruct, b: OracleVersionStruct) {
  return a.timestamp.eq(b.timestamp) && a.price.eq(b.price) && a.version.eq(b.version)
}

export default task('compareOracleVersions', 'Compares all versions for two oracles, starting from latest to 0')
  .addPositionalParam('a', 'Oracle 1 to query')
  .addPositionalParam('b', 'Oracle 2 to query')
  .setAction(async (args: TaskArguments, HRE: HardhatRuntimeEnvironment) => {
    const { ethers } = HRE
    const oracle1 = await ethers.getContractAt('IOracleProvider', args.a)
    const oracle2 = await ethers.getContractAt('IOracleProvider', args.b)

    const oracle1Latest = await oracle1.callStatic.sync()
    const oracle2Latest = await oracle2.callStatic.sync()
    if (oracle1Latest.version.toNumber() !== oracle2Latest.version.toNumber()) {
      console.log('Found difference:')
      console.log(asString(oracle1Latest), asString(oracle2Latest))
    }
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
