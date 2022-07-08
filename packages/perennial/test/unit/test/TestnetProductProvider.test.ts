import { MockContract } from '@ethereum-waffle/mock-contract'
import { utils } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import HRE, { waffle } from 'hardhat'

import {
  IOracleProvider__factory,
  TestnetProductProvider,
  TestnetProductProvider__factory,
} from '../../../types/generated'

const { ethers } = HRE

const TIMESTAMP = 1636920000

describe('TestnetProductProvider', () => {
  let user: SignerWithAddress
  let oracle: MockContract
  let testnetProductProvider: TestnetProductProvider

  beforeEach(async () => {
    ;[user] = await ethers.getSigners()
    oracle = await waffle.deployMockContract(user, IOracleProvider__factory.abi)
    testnetProductProvider = await new TestnetProductProvider__factory(user).deploy(oracle.address)
  })

  describe('#sync', async () => {
    it('calls sync on oracle', async () => {
      await oracle.mock.sync.withArgs().returns({
        price: utils.parseEther('11'),
        timestamp: TIMESTAMP,
        version: 1,
      })

      await testnetProductProvider.connect(user).sync()
    })
  })

  describe('#currentVersion', async () => {
    it('modifies oracle per payoff', async () => {
      await oracle.mock.currentVersion.withArgs().returns({
        price: utils.parseEther('11'),
        timestamp: TIMESTAMP,
        version: 2,
      })

      const oracleVersion = await testnetProductProvider.currentVersion()
      expect(oracleVersion.price).to.equal(utils.parseEther('121'))
      expect(oracleVersion.timestamp).to.equal(TIMESTAMP)
      expect(oracleVersion.version).to.equal(2)
    })
  })

  describe('#atVersion', async () => {
    it('modifies oracle per payoff', async () => {
      await oracle.mock.atVersion.withArgs(2).returns({
        price: utils.parseEther('11'),
        timestamp: TIMESTAMP,
        version: 2,
      })

      const oracleVersion = await testnetProductProvider.atVersion(2)
      expect(oracleVersion.price).to.equal(utils.parseEther('121'))
      expect(oracleVersion.timestamp).to.equal(TIMESTAMP)
      expect(oracleVersion.version).to.equal(2)
    })
  })
})
