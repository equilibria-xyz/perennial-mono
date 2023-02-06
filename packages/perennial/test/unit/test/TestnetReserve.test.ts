import { FakeContract, smock } from '@defi-wonderland/smock'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect, use } from 'chai'
import { utils } from 'ethers'
import HRE from 'hardhat'

import {
  ERC20PresetMinterPauser,
  IERC20Metadata,
  TestnetReserve,
  TestnetReserve__factory,
} from '../../../types/generated'

const { ethers } = HRE
use(smock.matchers)

describe('TestnetReserve', () => {
  let owner: SignerWithAddress
  let user: SignerWithAddress
  let usdc: FakeContract<IERC20Metadata>
  let dsu: FakeContract<ERC20PresetMinterPauser>
  let reserve: TestnetReserve

  beforeEach(async () => {
    ;[owner, user] = await ethers.getSigners()

    usdc = await smock.fake<IERC20Metadata>('IERC20Metadata')
    dsu = await smock.fake<ERC20PresetMinterPauser>('ERC20PresetMinterPauser')

    reserve = await new TestnetReserve__factory(owner).deploy(dsu.address, usdc.address)
  })

  describe('#constructor', () => {
    it('constructs correctly', async () => {
      expect(await reserve.DSU()).to.equal(dsu.address)
      expect(await reserve.USDC()).to.equal(usdc.address)
    })
  })

  describe('#mint', () => {
    it('pulls USDC from the sender, wraps it as DSU', async () => {
      usdc.transferFrom.whenCalledWith(user.address, reserve.address, 10e6).returns(true)
      dsu.mint.whenCalledWith(user.address, utils.parseEther('10')).returns(true)

      await expect(reserve.connect(user).mint(utils.parseEther('10')))
        .to.emit(reserve, 'Mint')
        .withArgs(user.address, utils.parseEther('10'), 10e6)
    })
  })

  describe('#unwrap', () => {
    it('pulls DSU from the sender, unwraps it to USDC', async () => {
      dsu.transferFrom.whenCalledWith(user.address, reserve.address, utils.parseEther('10')).returns(true)
      dsu.burn.whenCalledWith(utils.parseEther('10')).returns(true)
      usdc.transfer.whenCalledWith(user.address, 10e6).returns(true)

      await expect(reserve.connect(user).redeem(utils.parseEther('10')))
        .to.emit(reserve, 'Redeem')
        .withArgs(user.address, utils.parseEther('10'), 10e6)
    })
  })

  describe('#debt', () => {
    it('returns 0', async () => {
      expect(await reserve.debt(user.address)).to.equal(0)
    })
  })

  describe('#repay', () => {
    it('no-ops', async () => {
      await expect(reserve.repay(user.address, 0)).to.not.be.reverted
    })
  })
})
