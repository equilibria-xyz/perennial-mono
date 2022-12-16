import HRE from 'hardhat'
import { impersonate } from '../../../common/testutil'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { FakeContract, smock } from '@defi-wonderland/smock'
import { expect, use } from 'chai'
import {
  IERC20Metadata,
  IERC20Metadata__factory,
  IController__factory,
  IProduct,
  IProduct__factory,
  PerennialBalancedVault,
  PerennialBalancedVault__factory,
  IOracleProvider__factory,
  IOracleProvider,
} from '../../types/generated'
import { BigNumber, utils } from 'ethers'

const { ethers } = HRE
use(smock.matchers)

const DSU_HOLDER = '0x0B663CeaCEF01f2f88EB7451C70Aa069f19dB997'

describe('BalancedVault', () => {
  let vault: PerennialBalancedVault
  let asset: IERC20Metadata
  let oracle: FakeContract<IOracleProvider>
  let owner: SignerWithAddress
  let user: SignerWithAddress
  let long: IProduct
  let short: IProduct

  async function updateOracle(newPrice?: BigNumber) {
    const [currentVersion, currentTimestamp, currentPrice] = await oracle.currentVersion()
    const newVersion = {
      version: currentVersion.add(1),
      timestamp: currentTimestamp,
      price: newPrice ?? currentPrice,
    }
    oracle.sync.returns(newVersion)
    oracle.currentVersion.returns(newVersion)
    oracle.atVersion.whenCalledWith(newVersion.version).returns(newVersion)
  }

  async function longPosition() {
    return (await long.position(vault.address)).maker
  }

  async function shortPosition() {
    return (await short.position(vault.address)).maker
  }

  beforeEach(async () => {
    ;[owner, user] = await ethers.getSigners()

    const dsu = IERC20Metadata__factory.connect('0x605D26FBd5be761089281d5cec2Ce86eeA667109', owner)
    const controller = IController__factory.connect('0x9df509186b6d3b7D033359f94c8b1BB5544d51b3', owner)
    long = IProduct__factory.connect('0xdB60626FF6cDC9dB07d3625A93d21dDf0f8A688C', owner)
    short = IProduct__factory.connect('0xfeD3E166330341e0305594B8c6e6598F9f4Cbe9B', owner)

    vault = await new PerennialBalancedVault__factory(owner).deploy(
      dsu.address,
      controller.address,
      long.address,
      short.address,
      utils.parseEther('1'),
      utils.parseEther('10000'),
      utils.parseEther('1.1'),
    )
    asset = IERC20Metadata__factory.connect(await vault.asset(), owner)

    const dsuHolder = await impersonate.impersonateWithBalance(DSU_HOLDER, utils.parseEther('10'))
    await dsu.connect(dsuHolder).transfer(user.address, utils.parseEther('200000'))
    await dsu.connect(user).approve(vault.address, ethers.constants.MaxUint256)

    // Unfortunately, we can't make mocks of existing contracts.
    // So, we make a fake and initialize it with the values that the real contract had at this block.
    const realOracle = IOracleProvider__factory.connect('0xA59eF0208418559770a48D7ae4f260A28763167B', owner)
    const currentVersion = await realOracle.currentVersion()

    oracle = await smock.fake<IOracleProvider>('IOracleProvider', {
      address: '0xA59eF0208418559770a48D7ae4f260A28763167B',
    })
    oracle.sync.returns(currentVersion)
    oracle.currentVersion.returns(currentVersion)
    oracle.atVersion.whenCalledWith(currentVersion[0]).returns(currentVersion)
  })

  it('deposits successfully', async () => {
    await vault.connect(user).deposit(utils.parseEther('1000'), user.address)
    expect(await asset.connect(user).balanceOf(user.address)).to.be.greaterThan(0)
    await updateOracle()
    await vault.sync()

    // We're underneath the fixed loat, so we shouldn't have opened any positions.
    expect(await longPosition()).to.equal(0)
    expect(await shortPosition()).to.equal(0)

    await vault.connect(user).deposit(utils.parseEther('100000'), user.address)
    await updateOracle()
    await vault.sync()

    // Now we should have opened positions.
    // TODO: Check that the positions are correct.
    expect(await longPosition()).to.be.greaterThan(0)
    expect(await shortPosition()).to.equal(await longPosition())

    // TODO: Deposit more and see if the positions become larger.
  })

  // TESTS:
  //
  // - Invalid parameters should be rejected by all functions.
  // - Deposit odd amounts to test rounding. If we deposit odd amounts twice, the collateral should be equal.
  // - If we make a large deposit, we should be able to withdraw it if the oracle hasn't updated.
  // - We should be able to empty out the vault (no dust!)
  // - maxWithdraw should be correct (i.e. we can't withdraw maxWithdraw+1 but can withdraw maxWithdraw.)
  //
  // Liqudations:
  // - If a position is liquidated, we shouldn't be able to do any actions and maxWithdraw should return 0.
  // - If a position is liquidated, the vault should close all positions, then open them back up to the correct levels after rebalancing collateral.
})
