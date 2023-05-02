import HRE from 'hardhat'
import { time, impersonate } from '../../../../common/testutil'
import { deployProductOnMainnetFork } from '../helpers/setupHelpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { FakeContract, smock } from '@defi-wonderland/smock'
import { expect, use } from 'chai'
import {
  IERC20Metadata,
  IERC20Metadata__factory,
  IController,
  IController__factory,
  IProduct,
  IProduct__factory,
  BalancedVault,
  BalancedVault__factory,
  IOracleProvider__factory,
  IOracleProvider,
  ICollateral,
  ICollateral__factory,
  ChainlinkOracle__factory,
} from '../../../types/generated'
import { BigNumber, constants, utils } from 'ethers'

const { config, ethers } = HRE
use(smock.matchers)

const DSU_MINTER = '0xD05aCe63789cCb35B9cE71d01e4d632a0486Da4B'

describe('BalancedVault (Multi-Payoff)', () => {
  let vault: BalancedVault
  let asset: IERC20Metadata
  let oracle: FakeContract<IOracleProvider>
  let collateral: ICollateral
  let controller: IController
  let owner: SignerWithAddress
  let user: SignerWithAddress
  let user2: SignerWithAddress
  let perennialUser: SignerWithAddress
  let liquidator: SignerWithAddress
  let long: IProduct
  let short: IProduct
  let leverage: BigNumber
  let maxCollateral: BigNumber
  let originalOraclePrice: BigNumber
  let btcOriginalOraclePrice: BigNumber
  let btcOracle: FakeContract<IOracleProvider>
  let btcLong: IProduct
  let btcShort: IProduct

  async function updateOracle(newPrice?: BigNumber, newPriceBtc?: BigNumber) {
    await updateOracleEth(newPrice)
    await updateOracleBtc(newPriceBtc)
  }

  async function updateOracleEth(newPrice?: BigNumber) {
    const [currentVersion, currentTimestamp, currentPrice] = await oracle.currentVersion()
    const newVersion = {
      version: currentVersion.add(1),
      timestamp: currentTimestamp.add(13),
      price: newPrice ?? currentPrice,
    }
    oracle.sync.returns(newVersion)
    oracle.currentVersion.returns(newVersion)
    oracle.atVersion.whenCalledWith(newVersion.version).returns(newVersion)
  }

  async function updateOracleBtc(newPrice?: BigNumber) {
    const [currentVersion, currentTimestamp, currentPrice] = await btcOracle.currentVersion()
    const newVersion = {
      version: currentVersion.add(1),
      timestamp: currentTimestamp.add(13),
      price: newPrice ?? currentPrice,
    }
    btcOracle.sync.returns(newVersion)
    btcOracle.currentVersion.returns(newVersion)
    btcOracle.atVersion.whenCalledWith(newVersion.version).returns(newVersion)
  }

  async function updateOracleAndSync(newPrice?: BigNumber) {
    await updateOracle(newPrice)
    await vault.sync()
  }

  async function longPosition() {
    return (await long.position(vault.address)).maker
  }

  async function shortPosition() {
    return (await short.position(vault.address)).maker
  }

  async function btcLongPosition() {
    return (await btcLong.position(vault.address)).maker
  }

  async function btcShortPosition() {
    return (await btcShort.position(vault.address)).maker
  }

  async function longCollateralInVault() {
    return await collateral['collateral(address,address)'](vault.address, long.address)
  }

  async function shortCollateralInVault() {
    return await collateral['collateral(address,address)'](vault.address, short.address)
  }

  async function btcLongCollateralInVault() {
    return await collateral['collateral(address,address)'](vault.address, btcLong.address)
  }

  async function btcShortCollateralInVault() {
    return await collateral['collateral(address,address)'](vault.address, btcShort.address)
  }

  async function totalCollateralInVault() {
    return (await longCollateralInVault())
      .add(await shortCollateralInVault())
      .add(await btcLongCollateralInVault())
      .add(await btcShortCollateralInVault())
      .add(await asset.balanceOf(vault.address))
  }

  beforeEach(async () => {
    await time.reset(config)
    let btcUser1, btcUser2
    ;[owner, user, user2, liquidator, perennialUser, btcUser1, btcUser2] = await ethers.getSigners()

    const dsu = IERC20Metadata__factory.connect('0x605D26FBd5be761089281d5cec2Ce86eeA667109', owner)
    controller = IController__factory.connect('0x9df509186b6d3b7D033359f94c8b1BB5544d51b3', owner)
    long = IProduct__factory.connect('0xdB60626FF6cDC9dB07d3625A93d21dDf0f8A688C', owner)
    short = IProduct__factory.connect('0xfeD3E166330341e0305594B8c6e6598F9f4Cbe9B', owner)
    const btcOracleToMock = await new ChainlinkOracle__factory(owner).deploy(
      '0x47Fb2585D2C56Fe188D0E6ec628a38b74fCeeeDf',
      '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
      '0x0000000000000000000000000000000000000348',
    )
    btcLong = await deployProductOnMainnetFork({
      owner: owner,
      name: 'Bitcoin',
      symbol: 'BTC',
      baseCurrency: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
      quoteCurrency: '0x0000000000000000000000000000000000000348',
      oracle: btcOracleToMock.address,
      short: false,
    })
    btcShort = await deployProductOnMainnetFork({
      owner: owner,
      name: 'Bitcoin',
      symbol: 'BTC',
      baseCurrency: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
      quoteCurrency: '0x0000000000000000000000000000000000000348',
      oracle: btcOracleToMock.address,
      short: true,
    })
    collateral = ICollateral__factory.connect('0x2d264ebdb6632a06a1726193d4d37fef1e5dbdcd', owner)
    leverage = utils.parseEther('4.0')
    maxCollateral = utils.parseEther('500000')

    vault = await new BalancedVault__factory(owner).deploy(
      controller.address,
      leverage,
      maxCollateral,
      [
        {
          long: long.address,
          short: short.address,
          weight: 4,
        },
        {
          long: btcLong.address,
          short: btcShort.address,
          weight: 1,
        },
      ],
      ethers.constants.AddressZero,
    )
    await vault.initialize('Perennial Vault Alpha')
    asset = IERC20Metadata__factory.connect(await vault.asset(), owner)

    const dsuMinter = await impersonate.impersonateWithBalance(DSU_MINTER, utils.parseEther('10'))
    const setUpWalletWithDSU = async (wallet: SignerWithAddress, amount?: BigNumber) => {
      const dsuIface = new utils.Interface(['function mint(uint256)'])
      await dsuMinter.sendTransaction({
        to: dsu.address,
        value: 0,
        data: dsuIface.encodeFunctionData('mint', [amount ?? utils.parseEther('200000')]),
      })
      await dsu.connect(dsuMinter).transfer(wallet.address, amount ?? utils.parseEther('200000'))
      await dsu.connect(wallet).approve(vault.address, ethers.constants.MaxUint256)
    }
    await setUpWalletWithDSU(user)
    await setUpWalletWithDSU(user2)
    await setUpWalletWithDSU(liquidator)
    await setUpWalletWithDSU(perennialUser, utils.parseEther('1000000'))
    await setUpWalletWithDSU(btcUser1)
    await setUpWalletWithDSU(btcUser2)

    // Seed BTC markets with some activity
    await dsu.connect(btcUser1).approve(collateral.address, ethers.constants.MaxUint256)
    await dsu.connect(btcUser2).approve(collateral.address, ethers.constants.MaxUint256)
    await collateral.connect(btcUser1).depositTo(btcUser1.address, btcLong.address, utils.parseEther('100000'))
    await btcLong.connect(btcUser1).openMake(utils.parseEther('20'))
    await collateral.connect(btcUser1).depositTo(btcUser1.address, btcShort.address, utils.parseEther('100000'))
    await btcShort.connect(btcUser1).openMake(utils.parseEther('20'))
    await collateral.connect(btcUser2).depositTo(btcUser2.address, btcLong.address, utils.parseEther('100000'))
    await btcLong.connect(btcUser2).openTake(utils.parseEther('10'))
    await collateral.connect(btcUser2).depositTo(btcUser2.address, btcShort.address, utils.parseEther('100000'))
    await btcShort.connect(btcUser2).openTake(utils.parseEther('10'))

    // Unfortunately, we can't make mocks of existing contracts.
    // So, we make a fake and initialize it with the values that the real contract had at this block.
    const realOracle = IOracleProvider__factory.connect('0xA59eF0208418559770a48D7ae4f260A28763167B', owner)
    const currentVersion = await realOracle.currentVersion()
    originalOraclePrice = currentVersion[2]

    oracle = await smock.fake<IOracleProvider>('IOracleProvider', {
      address: '0x2C19eac953048801FfE1358D109A1Ac2aF7930fD',
    })
    oracle.sync.returns(currentVersion)
    oracle.currentVersion.returns(currentVersion)
    oracle.atVersion.whenCalledWith(currentVersion[0]).returns(currentVersion)

    const realBtcOracle = await new ChainlinkOracle__factory(owner).deploy(
      '0x47Fb2585D2C56Fe188D0E6ec628a38b74fCeeeDf',
      '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
      '0x0000000000000000000000000000000000000348',
    )
    const btcCurrentVersion = await realBtcOracle.currentVersion()
    btcOriginalOraclePrice = btcCurrentVersion[2]

    btcOracle = await smock.fake<IOracleProvider>('IOracleProvider', {
      address: btcOracleToMock.address,
    })
    btcOracle.sync.returns(btcCurrentVersion)
    btcOracle.currentVersion.returns(btcCurrentVersion)
    btcOracle.atVersion.whenCalledWith(btcCurrentVersion[0]).returns(btcCurrentVersion)
  })

  describe('#constructor', () => {
    it('checks that there is at least one market', async () => {
      await expect(
        new BalancedVault__factory(owner).deploy(
          controller.address,
          leverage,
          maxCollateral,
          [],
          ethers.constants.AddressZero,
        ),
      ).to.revertedWithCustomError(vault, 'BalancedVaultDefinitionNoMarketsError')
    })

    it('checks that at least one weight is greater than zero', async () => {
      await expect(
        new BalancedVault__factory(owner).deploy(
          controller.address,
          leverage,
          maxCollateral,
          [
            {
              long: long.address,
              short: short.address,
              weight: 0,
            },
          ],
          ethers.constants.AddressZero,
        ),
      ).to.revertedWithCustomError(vault, 'BalancedVaultDefinitionAllZeroWeightError')

      // At least one of the weights can be zero as long as not all of them are.
      await expect(
        new BalancedVault__factory(owner).deploy(
          controller.address,
          leverage,
          maxCollateral,
          [
            {
              long: long.address,
              short: short.address,
              weight: 0,
            },
            {
              long: long.address,
              short: short.address,
              weight: 1,
            },
          ],
          ethers.constants.AddressZero,
        ),
      ).to.not.be.reverted
    })

    it('checks that all products are valid', async () => {
      await expect(
        new BalancedVault__factory(owner).deploy(
          controller.address,
          leverage,
          maxCollateral,
          [
            {
              long: '0x0000000000000000000000000000000000000000',
              short: short.address,
              weight: 1,
            },
          ],
          ethers.constants.AddressZero,
        ),
      ).to.revertedWithCustomError(vault, 'BalancedVaultInvalidProductError')
    })

    it('checks that target leverage is positive', async () => {
      await expect(
        new BalancedVault__factory(owner).deploy(
          controller.address,
          0,
          maxCollateral,
          [
            {
              long: long.address,
              short: short.address,
              weight: 1,
            },
          ],
          ethers.constants.AddressZero,
        ),
      ).to.revertedWithCustomError(vault, 'BalancedVaultDefinitionZeroTargetLeverageError')
    })

    it('checks that the long and short are not identical', async () => {
      await expect(
        new BalancedVault__factory(owner).deploy(
          controller.address,
          leverage,
          maxCollateral,
          [
            {
              long: long.address,
              short: long.address,
              weight: 1,
            },
          ],
          ethers.constants.AddressZero,
        ),
      ).to.revertedWithCustomError(vault, 'BalancedVaultDefinitionLongAndShortAreSameProductError')
    })

    it('checks that the long and short oracles match', async () => {
      await expect(
        new BalancedVault__factory(owner).deploy(
          controller.address,
          leverage,
          maxCollateral,
          [
            {
              long: long.address,
              short: btcShort.address,
              weight: 1,
            },
          ],
          ethers.constants.AddressZero,
        ),
      ).to.revertedWithCustomError(vault, 'BalancedVaultDefinitionOracleMismatchError')
    })

    it('checks that the products have the right direction payoff', async () => {
      const incorrectBtcLong = await deployProductOnMainnetFork({
        owner: owner,
        name: 'Bitcoin',
        symbol: 'BTC',
        baseCurrency: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        quoteCurrency: '0x0000000000000000000000000000000000000348',
        oracle: btcOracle.address,
        short: true,
      })
      await expect(
        new BalancedVault__factory(owner).deploy(
          controller.address,
          leverage,
          maxCollateral,
          [
            {
              long: incorrectBtcLong.address,
              short: btcShort.address,
              weight: 1,
            },
          ],
          ethers.constants.AddressZero,
        ),
      ).to.revertedWithCustomError(vault, 'BalancedVaultDefinitionWrongPayoffDirectionError')

      const incorrectBtcShort = await deployProductOnMainnetFork({
        owner: owner,
        name: 'Bitcoin',
        symbol: 'BTC',
        baseCurrency: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        quoteCurrency: '0x0000000000000000000000000000000000000348',
        oracle: btcOracle.address,
        short: false,
      })
      await expect(
        new BalancedVault__factory(owner).deploy(
          controller.address,
          leverage,
          maxCollateral,
          [
            {
              long: btcLong.address,
              short: incorrectBtcShort.address,
              weight: 1,
            },
          ],
          ethers.constants.AddressZero,
        ),
      ).to.revertedWithCustomError(vault, 'BalancedVaultDefinitionWrongPayoffDirectionError')
    })

    it('checks that the products have the same payoff data', async () => {
      const btcLongWithPayoffData = await deployProductOnMainnetFork({
        owner: owner,
        name: 'Bitcoin',
        symbol: 'BTC',
        baseCurrency: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        quoteCurrency: '0x0000000000000000000000000000000000000348',
        oracle: btcOracle.address,
        short: false,
        payoffOracle: btcOracle.address,
      })

      const btcShortWithPayoffData = await deployProductOnMainnetFork({
        owner: owner,
        name: 'Bitcoin',
        symbol: 'BTC',
        baseCurrency: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB',
        quoteCurrency: '0x0000000000000000000000000000000000000348',
        oracle: btcOracle.address,
        short: true,
        payoffOracle: controller.address,
      })

      await expect(
        new BalancedVault__factory(owner).deploy(
          controller.address,
          leverage,
          maxCollateral,
          [
            {
              long: btcLongWithPayoffData.address,
              short: btcShortWithPayoffData.address,
              weight: 1,
            },
          ],
          ethers.constants.AddressZero,
        ),
      ).to.revertedWithCustomError(vault, 'BalancedVaultDefinitionMismatchedPayoffDataError')
    })

    it('checks that there are at least the markets of the previous implementation is a prefix of that of the new implementation ', async () => {
      // New implementation has fewer products than the previous implementation.
      await expect(
        new BalancedVault__factory(owner).deploy(
          controller.address,
          leverage,
          maxCollateral,
          [
            {
              long: long.address,
              short: short.address,
              weight: 4,
            },
          ],
          vault.address,
        ),
      ).to.revertedWithCustomError(vault, 'BalancedVaultDefinitionMarketsMismatchedWithPreviousImplementationError')

      // Markets are switched around in the new implementation.
      await expect(
        new BalancedVault__factory(owner).deploy(
          controller.address,
          leverage,
          maxCollateral,
          [
            {
              long: btcLong.address,
              short: btcShort.address,
              weight: 1,
            },
            {
              long: long.address,
              short: short.address,
              weight: 4,
            },
          ],
          vault.address,
        ),
      ).to.revertedWithCustomError(vault, 'BalancedVaultDefinitionMarketsMismatchedWithPreviousImplementationError')
    })
  })

  describe('#initialize', () => {
    it('cant re-initialize', async () => {
      await expect(vault.initialize('Perennial Vault Alpha')).to.revertedWithCustomError(
        vault,
        'UInitializableAlreadyInitializedError',
      )
    })
  })

  describe('#name', () => {
    it('is correct', async () => {
      expect(await vault.name()).to.equal('Perennial Vault Alpha')
    })
  })

  describe('#approve', () => {
    it('approves correctly', async () => {
      expect(await vault.allowance(user.address, liquidator.address)).to.eq(0)

      await expect(vault.connect(user).approve(liquidator.address, utils.parseEther('10')))
        .to.emit(vault, 'Approval')
        .withArgs(user.address, liquidator.address, utils.parseEther('10'))

      expect(await vault.allowance(user.address, liquidator.address)).to.eq(utils.parseEther('10'))

      await expect(vault.connect(user).approve(liquidator.address, 0))
        .to.emit(vault, 'Approval')
        .withArgs(user.address, liquidator.address, 0)

      expect(await vault.allowance(user.address, liquidator.address)).to.eq(0)
    })
  })

  describe('#deposit/#redeem/#claim/#sync', () => {
    it('simple deposits and withdraws', async () => {
      expect(await vault.convertToAssets(utils.parseEther('1'))).to.equal(utils.parseEther('1'))
      expect(await vault.convertToShares(utils.parseEther('1'))).to.equal(utils.parseEther('1'))

      const smallDeposit = utils.parseEther('10')
      await vault.connect(user).deposit(smallDeposit, user.address)
      expect(await longCollateralInVault()).to.equal(0)
      expect(await shortCollateralInVault()).to.equal(0)
      expect(await btcLongCollateralInVault()).to.equal(0)
      expect(await btcShortCollateralInVault()).to.equal(0)
      expect(await vault.totalSupply()).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      await updateOracle()
      await vault.sync()

      // We're underneath the collateral minimum, so we shouldn't have opened any positions.
      expect(await longPosition()).to.equal(0)
      expect(await shortPosition()).to.equal(0)
      expect(await btcLongPosition()).to.equal(0)
      expect(await btcShortPosition()).to.equal(0)

      const largeDeposit = utils.parseEther('10000')
      await vault.connect(user).deposit(largeDeposit, user.address)
      expect(await longCollateralInVault()).to.equal(utils.parseEther('4004'))
      expect(await shortCollateralInVault()).to.equal(utils.parseEther('4004'))
      expect(await btcLongCollateralInVault()).to.equal(utils.parseEther('1001'))
      expect(await btcShortCollateralInVault()).to.equal(utils.parseEther('1001'))
      expect(await vault.balanceOf(user.address)).to.equal(smallDeposit)
      expect(await vault.totalSupply()).to.equal(smallDeposit)
      expect(await vault.totalAssets()).to.equal(smallDeposit)
      expect(await vault.convertToAssets(utils.parseEther('10'))).to.equal(utils.parseEther('10'))
      expect(await vault.convertToShares(utils.parseEther('10'))).to.equal(utils.parseEther('10'))
      await updateOracle()
      await vault.sync()

      expect(await vault.balanceOf(user.address)).to.equal(utils.parseEther('10010'))
      expect(await vault.totalSupply()).to.equal(utils.parseEther('10010'))
      expect(await vault.totalAssets()).to.equal(utils.parseEther('10010'))
      expect(await vault.convertToAssets(utils.parseEther('10010'))).to.equal(utils.parseEther('10010'))
      expect(await vault.convertToShares(utils.parseEther('10010'))).to.equal(utils.parseEther('10010'))

      // Now we should have opened positions.
      // The positions should be equal to (smallDeposit + largeDeposit) * leverage / 2 / originalOraclePrice.
      expect(await longPosition()).to.equal(
        smallDeposit.add(largeDeposit).mul(leverage).mul(4).div(5).div(2).div(originalOraclePrice),
      )
      expect(await shortPosition()).to.equal(
        smallDeposit.add(largeDeposit).mul(leverage).mul(4).div(5).div(2).div(originalOraclePrice),
      )
      expect(await btcLongPosition()).to.equal(
        smallDeposit.add(largeDeposit).mul(leverage).div(5).div(2).div(btcOriginalOraclePrice),
      )
      expect(await btcShortPosition()).to.equal(
        smallDeposit.add(largeDeposit).mul(leverage).div(5).div(2).div(btcOriginalOraclePrice),
      )

      // User 2 should not be able to withdraw; they haven't deposited anything.
      await expect(vault.connect(user2).redeem(1, user2.address)).to.be.revertedWithCustomError(
        vault,
        'BalancedVaultRedemptionLimitExceeded',
      )

      expect(await vault.maxRedeem(user.address)).to.equal(utils.parseEther('10010'))
      await vault.connect(user).redeem(await vault.maxRedeem(user.address), user.address)
      await updateOracle()
      await vault.sync()

      // We should have closed all positions.
      expect(await longPosition()).to.equal(0)
      expect(await shortPosition()).to.equal(0)
      expect(await btcLongPosition()).to.equal(0)
      expect(await btcShortPosition()).to.equal(0)

      // We should have withdrawn all of our collateral.
      const fundingAmount = BigNumber.from('824939190034966')
      expect(await totalCollateralInVault()).to.equal(utils.parseEther('10010').add(fundingAmount))
      expect(await vault.balanceOf(user.address)).to.equal(0)
      expect(await vault.totalSupply()).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      expect(await vault.convertToAssets(utils.parseEther('1'))).to.equal(utils.parseEther('1'))
      expect(await vault.convertToShares(utils.parseEther('1'))).to.equal(utils.parseEther('1'))
      expect(await vault.unclaimed(user.address)).to.equal(utils.parseEther('10010').add(fundingAmount))
      expect(await vault.totalUnclaimed()).to.equal(utils.parseEther('10010').add(fundingAmount))

      await vault.connect(user).claim(user.address)
      expect(await totalCollateralInVault()).to.equal(0)
      expect(await asset.balanceOf(user.address)).to.equal(utils.parseEther('200000').add(fundingAmount))
      expect(await vault.unclaimed(user.address)).to.equal(0)
      expect(await vault.totalUnclaimed()).to.equal(0)
    })

    it('multiple users', async () => {
      expect(await vault.convertToAssets(utils.parseEther('1'))).to.equal(utils.parseEther('1'))
      expect(await vault.convertToShares(utils.parseEther('1'))).to.equal(utils.parseEther('1'))

      const smallDeposit = utils.parseEther('1000')
      await vault.connect(user).deposit(smallDeposit, user.address)
      await updateOracle()
      await vault.sync()

      const largeDeposit = utils.parseEther('10000')
      await vault.connect(user2).deposit(largeDeposit, user2.address)
      await updateOracle()
      await vault.sync()

      // Now we should have opened positions.
      // The positions should be equal to (smallDeposit + largeDeposit) * leverage / 2 / originalOraclePrice.
      expect(await longPosition()).to.be.equal(
        smallDeposit.add(largeDeposit).mul(leverage).mul(4).div(5).div(2).div(originalOraclePrice),
      )
      expect(await shortPosition()).to.equal(
        smallDeposit.add(largeDeposit).mul(leverage).mul(4).div(5).div(2).div(originalOraclePrice),
      )
      expect(await btcLongPosition()).to.be.equal(
        smallDeposit.add(largeDeposit).mul(leverage).div(5).div(2).div(btcOriginalOraclePrice),
      )
      expect(await btcShortPosition()).to.equal(
        smallDeposit.add(largeDeposit).mul(leverage).div(5).div(2).div(btcOriginalOraclePrice),
      )
      const fundingAmount0 = BigNumber.from(83666424963960)
      const balanceOf2 = BigNumber.from('9999999163335820361100')
      expect(await vault.balanceOf(user.address)).to.equal(utils.parseEther('1000'))
      expect(await vault.balanceOf(user2.address)).to.equal(balanceOf2)
      expect(await vault.totalAssets()).to.equal(utils.parseEther('11000').add(fundingAmount0))
      expect(await vault.totalSupply()).to.equal(utils.parseEther('1000').add(balanceOf2))
      expect(await vault.convertToAssets(utils.parseEther('1000').add(balanceOf2))).to.equal(
        utils.parseEther('11000').add(fundingAmount0),
      )
      expect(await vault.convertToShares(utils.parseEther('11000').add(fundingAmount0))).to.equal(
        utils.parseEther('1000').add(balanceOf2),
      )

      const maxRedeem = await vault.maxRedeem(user.address)
      await vault.connect(user).redeem(maxRedeem, user.address)
      await updateOracle()
      await vault.sync()

      const maxRedeem2 = await vault.maxRedeem(user2.address)
      await vault.connect(user2).redeem(maxRedeem2, user2.address)
      await updateOracle()
      await vault.sync()

      // We should have closed all positions.
      expect(await longPosition()).to.equal(0)
      expect(await shortPosition()).to.equal(0)
      expect(await btcLongPosition()).to.equal(0)
      expect(await btcShortPosition()).to.equal(0)

      // We should have withdrawn all of our collateral.
      const fundingAmount = BigNumber.from('165941798239422')
      const fundingAmount2 = BigNumber.from('1646882507931229')
      expect(await totalCollateralInVault()).to.equal(utils.parseEther('11000').add(fundingAmount).add(fundingAmount2))
      expect(await vault.balanceOf(user.address)).to.equal(0)
      expect(await vault.balanceOf(user2.address)).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      expect(await vault.totalSupply()).to.equal(0)
      expect(await vault.convertToAssets(utils.parseEther('1'))).to.equal(utils.parseEther('1'))
      expect(await vault.convertToShares(utils.parseEther('1'))).to.equal(utils.parseEther('1'))
      expect(await vault.unclaimed(user.address)).to.equal(utils.parseEther('1000').add(fundingAmount))
      expect(await vault.unclaimed(user2.address)).to.equal(utils.parseEther('10000').add(fundingAmount2))
      expect(await vault.totalUnclaimed()).to.equal(utils.parseEther('11000').add(fundingAmount).add(fundingAmount2))

      await vault.connect(user).claim(user.address)
      await vault.connect(user2).claim(user2.address)

      expect(await totalCollateralInVault()).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      expect(await asset.balanceOf(user.address)).to.equal(utils.parseEther('200000').add(fundingAmount))
      expect(await asset.balanceOf(user2.address)).to.equal(utils.parseEther('200000').add(fundingAmount2))
      expect(await vault.unclaimed(user2.address)).to.equal(0)
      expect(await vault.totalUnclaimed()).to.equal(0)
    })

    it('deposit during withdraw', async () => {
      expect(await vault.convertToAssets(utils.parseEther('1'))).to.equal(utils.parseEther('1'))
      expect(await vault.convertToShares(utils.parseEther('1'))).to.equal(utils.parseEther('1'))

      const smallDeposit = utils.parseEther('1000')
      await vault.connect(user).deposit(smallDeposit, user.address)
      await updateOracle()
      await vault.sync()

      const largeDeposit = utils.parseEther('2000')
      await vault.connect(user2).deposit(largeDeposit, user2.address)
      await vault.connect(user).redeem(utils.parseEther('400'), user.address)
      await updateOracle()
      await vault.sync()

      // Now we should have opened positions.
      // The positions should be equal to (smallDeposit + largeDeposit) * leverage / 2 / originalOraclePrice.
      expect(await longPosition()).to.be.equal(
        smallDeposit
          .add(largeDeposit)
          .sub(utils.parseEther('400'))
          .mul(4)
          .div(5)
          .mul(leverage)
          .div(2)
          .div(originalOraclePrice),
      )
      expect(await shortPosition()).to.equal(
        smallDeposit
          .add(largeDeposit)
          .sub(utils.parseEther('400'))
          .mul(4)
          .div(5)
          .mul(leverage)
          .div(2)
          .div(originalOraclePrice),
      )
      expect(await btcLongPosition()).to.be.equal(
        smallDeposit
          .add(largeDeposit)
          .sub(utils.parseEther('400'))
          .div(5)
          .mul(leverage)
          .div(2)
          .div(btcOriginalOraclePrice),
      )
      expect(await btcShortPosition()).to.equal(
        smallDeposit
          .add(largeDeposit)
          .sub(utils.parseEther('400'))
          .div(5)
          .mul(leverage)
          .div(2)
          .div(btcOriginalOraclePrice),
      )
      const fundingAmount0 = BigNumber.from('50199854978376')
      const balanceOf2 = BigNumber.from('1999999832667164072220')
      expect(await vault.balanceOf(user.address)).to.equal(utils.parseEther('600'))
      expect(await vault.balanceOf(user2.address)).to.equal(balanceOf2)
      expect(await vault.totalAssets()).to.equal(utils.parseEther('2600').add(fundingAmount0))
      expect(await totalCollateralInVault()).to.equal(
        utils
          .parseEther('2600')
          .add(fundingAmount0)
          .add(await vault.totalUnclaimed()),
      )
      expect(await vault.totalSupply()).to.equal(utils.parseEther('600').add(balanceOf2))
      expect(await vault.convertToAssets(utils.parseEther('600').add(balanceOf2))).to.equal(
        utils.parseEther('2600').add(fundingAmount0),
      )
      expect(await vault.convertToShares(utils.parseEther('2600').add(fundingAmount0))).to.equal(
        utils.parseEther('600').add(balanceOf2),
      )

      const maxRedeem = await vault.maxRedeem(user.address)
      await vault.connect(user).redeem(maxRedeem, user.address)
      await updateOracle()
      await vault.sync()

      const maxRedeem2 = await vault.maxRedeem(user2.address)
      await vault.connect(user2).redeem(maxRedeem2, user2.address)
      await updateOracle()
      await vault.sync()

      // We should have closed all positions.
      expect(await longPosition()).to.equal(0)
      expect(await shortPosition()).to.equal(0)
      expect(await btcLongPosition()).to.equal(0)
      expect(await btcShortPosition()).to.equal(0)

      // We should have withdrawn all of our collateral.
      const fundingAmount = BigNumber.from('133731306363245')
      const fundingAmount2 = BigNumber.from('333934356519138')
      expect(await totalCollateralInVault()).to.equal(utils.parseEther('3000').add(fundingAmount).add(fundingAmount2))
      expect(await vault.balanceOf(user.address)).to.equal(0)
      expect(await vault.balanceOf(user2.address)).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      expect(await vault.totalSupply()).to.equal(0)
      expect(await vault.convertToAssets(utils.parseEther('1'))).to.equal(utils.parseEther('1'))
      expect(await vault.convertToShares(utils.parseEther('1'))).to.equal(utils.parseEther('1'))
      expect(await vault.unclaimed(user.address)).to.equal(utils.parseEther('1000').add(fundingAmount))
      expect(await vault.unclaimed(user2.address)).to.equal(utils.parseEther('2000').add(fundingAmount2))
      expect(await vault.totalUnclaimed()).to.equal(utils.parseEther('3000').add(fundingAmount).add(fundingAmount2))

      await vault.connect(user).claim(user.address)
      await vault.connect(user2).claim(user2.address)

      expect(await totalCollateralInVault()).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      expect(await asset.balanceOf(user.address)).to.equal(utils.parseEther('200000').add(fundingAmount))
      expect(await asset.balanceOf(user2.address)).to.equal(utils.parseEther('200000').add(fundingAmount2))
      expect(await vault.unclaimed(user2.address)).to.equal(0)
      expect(await vault.totalUnclaimed()).to.equal(0)
    })

    it('oracles offset', async () => {
      expect(await vault.convertToAssets(utils.parseEther('1'))).to.equal(utils.parseEther('1'))
      expect(await vault.convertToShares(utils.parseEther('1'))).to.equal(utils.parseEther('1'))

      const smallDeposit = utils.parseEther('1000')
      await vault.connect(user).deposit(smallDeposit, user.address)
      await updateOracleEth()
      await updateOracleEth()
      await updateOracleEth()
      await updateOracleEth()
      await updateOracleBtc()
      await vault.sync()

      const largeDeposit = utils.parseEther('10000')
      const assetsForPosition = (await vault.totalAssets()).add(largeDeposit)
      await vault.connect(user2).deposit(largeDeposit, user2.address)
      await updateOracleEth()
      await updateOracleEth()
      await updateOracleEth()
      await updateOracleEth()
      await updateOracleBtc()
      await vault.sync()

      // Now we should have opened positions.
      // The positions should be equal to (smallDeposit + largeDeposit) * leverage / 2 / originalOraclePrice.
      expect(await longPosition()).to.be.equal(
        assetsForPosition.mul(leverage).mul(4).div(5).div(2).div(originalOraclePrice),
      )
      expect(await shortPosition()).to.equal(
        assetsForPosition.mul(leverage).mul(4).div(5).div(2).div(originalOraclePrice),
      )
      expect(await btcLongPosition()).to.be.equal(
        assetsForPosition.mul(leverage).div(5).div(2).div(btcOriginalOraclePrice),
      )
      expect(await btcShortPosition()).to.equal(
        assetsForPosition.mul(leverage).div(5).div(2).div(btcOriginalOraclePrice),
      )
      const fundingAmount0 = BigNumber.from(88080044500152)
      const balanceOf2 = BigNumber.from('9999999159583484821247')
      expect(await vault.balanceOf(user.address)).to.equal(utils.parseEther('1000'))
      expect(await vault.balanceOf(user2.address)).to.equal(balanceOf2)
      expect(await vault.totalAssets()).to.equal(utils.parseEther('11000').add(fundingAmount0))
      expect(await vault.totalSupply()).to.equal(utils.parseEther('1000').add(balanceOf2))
      expect(await vault.convertToAssets(utils.parseEther('1000').add(balanceOf2))).to.equal(
        utils.parseEther('11000').add(fundingAmount0),
      )
      expect(await vault.convertToShares(utils.parseEther('11000').add(fundingAmount0))).to.equal(
        utils.parseEther('1000').add(balanceOf2),
      )

      const maxRedeem = await vault.maxRedeem(user.address)
      await vault.connect(user).redeem(maxRedeem, user.address)
      await updateOracleEth()
      await updateOracleEth()
      await updateOracleEth()
      await updateOracleEth()
      await updateOracleBtc()
      await vault.sync()

      const maxRedeem2 = await vault.maxRedeem(user2.address)
      await vault.connect(user2).redeem(maxRedeem2, user2.address)
      await updateOracleEth()
      await updateOracleEth()
      await updateOracleEth()
      await updateOracleEth()
      await updateOracleBtc()
      await vault.sync()

      // We should have closed all positions.
      expect(await longPosition()).to.equal(0)
      expect(await shortPosition()).to.equal(0)
      expect(await btcLongPosition()).to.equal(0)
      expect(await btcShortPosition()).to.equal(0)

      // We should have withdrawn all of our collateral.
      const fundingAmount = BigNumber.from('166684157907894')
      const fundingAmount2 = BigNumber.from('1654233009885413')
      expect(await totalCollateralInVault()).to.equal(utils.parseEther('11000').add(fundingAmount).add(fundingAmount2))
      expect(await vault.balanceOf(user.address)).to.equal(0)
      expect(await vault.balanceOf(user2.address)).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      expect(await vault.totalSupply()).to.equal(0)
      expect(await vault.convertToAssets(utils.parseEther('1'))).to.equal(utils.parseEther('1'))
      expect(await vault.convertToShares(utils.parseEther('1'))).to.equal(utils.parseEther('1'))
      expect(await vault.unclaimed(user.address)).to.equal(utils.parseEther('1000').add(fundingAmount))
      expect(await vault.unclaimed(user2.address)).to.equal(utils.parseEther('10000').add(fundingAmount2))
      expect(await vault.totalUnclaimed()).to.equal(utils.parseEther('11000').add(fundingAmount).add(fundingAmount2))

      await vault.connect(user).claim(user.address)
      await vault.connect(user2).claim(user2.address)

      expect(await totalCollateralInVault()).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      expect(await asset.balanceOf(user.address)).to.equal(utils.parseEther('200000').add(fundingAmount))
      expect(await asset.balanceOf(user2.address)).to.equal(utils.parseEther('200000').add(fundingAmount2))
      expect(await vault.unclaimed(user2.address)).to.equal(0)
      expect(await vault.totalUnclaimed()).to.equal(0)
    })

    it('oracles offset during pending', async () => {
      expect(await vault.convertToAssets(utils.parseEther('1'))).to.equal(utils.parseEther('1'))
      expect(await vault.convertToShares(utils.parseEther('1'))).to.equal(utils.parseEther('1'))

      const smallDeposit = utils.parseEther('1000')
      await vault.connect(user).deposit(smallDeposit, user.address)
      await updateOracleEth()
      await updateOracleEth()
      await updateOracleEth()
      await updateOracleEth()
      await updateOracleBtc()
      await vault.sync()

      const largeDeposit = utils.parseEther('10000')
      await vault.connect(user2).deposit(largeDeposit, user2.address)
      await updateOracleEth()
      await vault.connect(user2).deposit(largeDeposit, user2.address)
      let assetsForPosition = (await vault.totalAssets()).add(largeDeposit)
      await updateOracleEth()
      await updateOracleEth()
      await updateOracleEth()
      await updateOracleBtc()
      await vault.sync()

      // Now we should have opened positions.
      // The positions should be equal to (smallDeposit + largeDeposit) * leverage / 2 / originalOraclePrice.
      expect(await longPosition()).to.be.equal(
        assetsForPosition.mul(leverage).mul(4).div(5).div(2).div(originalOraclePrice),
      )
      expect(await shortPosition()).to.equal(
        assetsForPosition.mul(leverage).mul(4).div(5).div(2).div(originalOraclePrice),
      )
      expect(await btcLongPosition()).to.be.equal(
        assetsForPosition.mul(leverage).div(5).div(2).div(btcOriginalOraclePrice),
      )
      expect(await btcShortPosition()).to.equal(
        assetsForPosition.mul(leverage).div(5).div(2).div(btcOriginalOraclePrice),
      )
      const fundingAmount0 = BigNumber.from(88080044500182)
      const balanceOf2 = BigNumber.from('9999999159583484821247')
      expect(await vault.balanceOf(user.address)).to.equal(utils.parseEther('1000'))
      expect(await vault.balanceOf(user2.address)).to.equal(balanceOf2)
      expect(await vault.totalAssets()).to.equal(utils.parseEther('11000').add(fundingAmount0))
      expect(await vault.totalSupply()).to.equal(utils.parseEther('1000').add(balanceOf2))
      expect(await vault.convertToAssets(utils.parseEther('1000').add(balanceOf2))).to.equal(
        utils.parseEther('11000').add(fundingAmount0),
      )
      expect(await vault.convertToShares(utils.parseEther('11000').add(fundingAmount0))).to.equal(
        utils.parseEther('1000').add(balanceOf2),
      )

      // Do another epoch update to get pending deposits in
      assetsForPosition = (await vault.totalAssets()).add(largeDeposit)
      await updateOracleEth()
      await updateOracleBtc()
      await vault.sync()
      await vault.syncAccount(user.address)
      await vault.syncAccount(user2.address)

      // Now we should have opened positions.
      // The positions should be equal to (smallDeposit + largeDeposit) * leverage / 2 / originalOraclePrice.
      expect(await longPosition()).to.be.equal(
        assetsForPosition.mul(leverage).mul(4).div(5).div(2).div(originalOraclePrice),
      )
      expect(await shortPosition()).to.equal(
        assetsForPosition.mul(leverage).mul(4).div(5).div(2).div(originalOraclePrice),
      )
      expect(await btcLongPosition()).to.be.equal(
        assetsForPosition.mul(leverage).div(5).div(2).div(btcOriginalOraclePrice),
      )
      expect(await btcShortPosition()).to.equal(
        assetsForPosition.mul(leverage).div(5).div(2).div(btcOriginalOraclePrice),
      )
      const fundingAmount1 = BigNumber.from(993109081734194)
      const balanceOf2_1 = BigNumber.from('19999997492742183569043')
      expect(await vault.balanceOf(user.address)).to.equal(utils.parseEther('1000'))
      expect(await vault.balanceOf(user2.address)).to.equal(balanceOf2_1)
      expect(await vault.totalAssets()).to.equal(utils.parseEther('21000').add(fundingAmount1))
      expect(await vault.totalSupply()).to.equal(utils.parseEther('1000').add(balanceOf2_1))
      expect(await vault.convertToAssets(utils.parseEther('1000').add(balanceOf2_1))).to.equal(
        utils.parseEther('21000').add(fundingAmount1),
      )
      expect(await vault.convertToShares(utils.parseEther('21000').add(fundingAmount1))).to.equal(
        utils.parseEther('1000').add(balanceOf2_1),
      )

      const maxRedeem = await vault.maxRedeem(user.address)
      await vault.connect(user).redeem(maxRedeem, user.address)
      await updateOracleEth()
      await updateOracleEth()
      await updateOracleEth()
      await updateOracleEth()
      await updateOracleBtc()
      await vault.sync()

      await vault.connect(user2).redeem(utils.parseEther('10000'), user2.address)
      await updateOracleEth()
      const maxRedeem2 = await vault.maxRedeem(user2.address)
      await vault.connect(user2).redeem(maxRedeem2, user2.address)
      await updateOracleEth()
      await updateOracleEth()
      await updateOracleEth()
      await updateOracleBtc()
      await vault.sync()

      await updateOracleEth()
      await updateOracleBtc()
      await vault.sync()
      await vault.syncAccount(user.address)
      await vault.syncAccount(user2.address)

      // We should have closed all positions.
      expect(await longPosition()).to.equal(0)
      expect(await shortPosition()).to.equal(0)
      expect(await btcLongPosition()).to.equal(0)
      expect(await btcShortPosition()).to.equal(0)

      // We should have withdrawn all of our collateral.
      const fundingAmount = BigNumber.from('247603340304160')
      const fundingAmount2 = BigNumber.from('4900882935203790')
      expect(await totalCollateralInVault()).to.equal(utils.parseEther('21000').add(fundingAmount).add(fundingAmount2))
      expect(await vault.balanceOf(user.address)).to.equal(0)
      expect(await vault.balanceOf(user2.address)).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      expect(await vault.totalSupply()).to.equal(0)
      expect(await vault.convertToAssets(utils.parseEther('1'))).to.equal(utils.parseEther('1'))
      expect(await vault.convertToShares(utils.parseEther('1'))).to.equal(utils.parseEther('1'))
      expect(await vault.unclaimed(user.address)).to.equal(utils.parseEther('1000').add(fundingAmount))
      expect(await vault.unclaimed(user2.address)).to.equal(utils.parseEther('20000').add(fundingAmount2))
      expect(await vault.totalUnclaimed()).to.equal(utils.parseEther('21000').add(fundingAmount).add(fundingAmount2))

      await vault.connect(user).claim(user.address)
      await vault.connect(user2).claim(user2.address)

      expect(await totalCollateralInVault()).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      expect(await asset.balanceOf(user.address)).to.equal(utils.parseEther('200000').add(fundingAmount))
      expect(await asset.balanceOf(user2.address)).to.equal(utils.parseEther('200000').add(fundingAmount2))
      expect(await vault.unclaimed(user2.address)).to.equal(0)
      expect(await vault.totalUnclaimed()).to.equal(0)
    })

    it('maxRedeem', async () => {
      const smallDeposit = utils.parseEther('1000')
      await vault.connect(user).deposit(smallDeposit, user.address)
      await updateOracle()
      await vault.sync()

      const shareAmount = BigNumber.from(utils.parseEther('1000'))
      expect(await vault.maxRedeem(user.address)).to.equal(shareAmount)

      const largeDeposit = utils.parseEther('10000')
      await vault.connect(user).deposit(largeDeposit, user.address)
      await updateOracle()
      await vault.sync()

      const shareAmount2 = BigNumber.from('9999999163335820361100')
      expect(await vault.maxRedeem(user.address)).to.equal(shareAmount.add(shareAmount2))

      // We shouldn't be able to withdraw more than maxRedeem.
      await expect(
        vault.connect(user).redeem((await vault.maxRedeem(user.address)).add(1), user.address),
      ).to.be.revertedWithCustomError(vault, 'BalancedVaultRedemptionLimitExceeded')

      // But we should be able to withdraw exactly maxRedeem.
      await vault.connect(user).redeem(await vault.maxRedeem(user.address), user.address)

      // The oracle price hasn't changed yet, so we shouldn't be able to withdraw any more.
      expect(await vault.maxRedeem(user.address)).to.equal(0)

      // But if we update the oracle price, we should be able to withdraw the rest of our collateral.
      await updateOracle()
      await vault.sync()

      expect(await longPosition()).to.equal(0)
      expect(await shortPosition()).to.equal(0)
      expect(await btcLongPosition()).to.equal(0)
      expect(await btcShortPosition()).to.equal(0)

      // Our collateral should be less than the fixedFloat and greater than 0.
      await vault.claim(user.address)
      expect(await totalCollateralInVault()).to.eq(0)
      expect(await vault.totalAssets()).to.equal(0)
    })

    it('maxRedeem with close limited', async () => {
      const largeDeposit = utils.parseEther('10000')
      await vault.connect(user).deposit(largeDeposit, user.address)
      await updateOracle()
      await vault.sync()

      const btcGlobalPre = await btcLong['pre()']()
      const btcGlobalPosition = await btcLong.positionAtVersion(await btcLong['latestVersion()']())
      const btcGlobalNext = {
        maker: btcGlobalPosition.maker.add(btcGlobalPre.openPosition.maker.sub(btcGlobalPre.closePosition.maker)),
        taker: btcGlobalPosition.taker.add(btcGlobalPre.openPosition.taker.sub(btcGlobalPre.closePosition.taker)),
      }
      // Open taker position up to 100% utilization minus 1 BTC
      await asset.connect(perennialUser).approve(collateral.address, constants.MaxUint256)
      await collateral
        .connect(perennialUser)
        .depositTo(perennialUser.address, btcLong.address, utils.parseEther('1000000'))
      await btcLong
        .connect(perennialUser)
        .openTake(btcGlobalNext.maker.sub(btcGlobalNext.taker).sub(utils.parseEther('0.1')))

      await updateOracle()
      await btcLong.settle()

      // The vault can close 1 BTC of maker positions in the long market, which means the user can withdraw double this amount
      const expectedMaxRedeem = await vault.convertToShares(
        btcOriginalOraclePrice.mul(utils.parseEther('0.1')).mul(2).div(leverage).mul(5),
      )
      expect(await vault.maxRedeem(user.address)).to.equal(expectedMaxRedeem)

      await vault.sync()

      await expect(
        vault.connect(user).redeem((await vault.maxRedeem(user.address)).add(1), user.address),
      ).to.be.revertedWithCustomError(vault, 'BalancedVaultRedemptionLimitExceeded')

      await expect(vault.connect(user).redeem(await vault.maxRedeem(user.address), user.address)).to.not.be.reverted
    })

    it('maxDeposit', async () => {
      expect(await vault.maxDeposit(user.address)).to.equal(maxCollateral)
      const depositSize = utils.parseEther('200000')

      await vault.connect(user).deposit(depositSize, user.address)
      expect(await vault.maxDeposit(user.address)).to.equal(maxCollateral.sub(depositSize))

      await vault.connect(user2).deposit(utils.parseEther('200000'), user2.address)
      expect(await vault.maxDeposit(user.address)).to.equal(maxCollateral.sub(depositSize).sub(depositSize))

      await vault.connect(liquidator).deposit(utils.parseEther('100000'), liquidator.address)
      expect(await vault.maxDeposit(user.address)).to.equal(0)

      await expect(vault.connect(liquidator).deposit(1, liquidator.address)).to.revertedWithCustomError(
        vault,
        'BalancedVaultDepositLimitExceeded',
      )
    })

    it('rebalances collateral', async () => {
      await vault.connect(user).deposit(utils.parseEther('100000'), user.address)
      await updateOracle()
      await vault.sync()

      const originalTotalCollateral = await totalCollateralInVault()

      // Collaterals should be equal.
      expect(await longCollateralInVault()).to.equal(await shortCollateralInVault())
      expect(await btcLongCollateralInVault()).to.equal(await btcShortCollateralInVault())

      await updateOracle(utils.parseEther('1300'))
      await long.connect(user).settleAccount(vault.address)
      await short.connect(user).settleAccount(vault.address)

      // Collaterals should not be equal any more.
      expect(await longCollateralInVault()).to.not.equal(await shortCollateralInVault())
      expect(await btcLongCollateralInVault()).to.equal(await btcShortCollateralInVault())

      await vault.sync()

      // Collaterals should be equal again!
      expect(await longCollateralInVault()).to.equal(await shortCollateralInVault())
      expect(await btcLongCollateralInVault()).to.equal(await btcShortCollateralInVault())

      await updateOracle(originalOraclePrice)
      await vault.sync()

      // Since the price changed then went back to the original, the total collateral should have increased.
      const fundingAmount = BigNumber.from('14258756963781699')
      expect(await totalCollateralInVault()).to.eq(originalTotalCollateral.add(fundingAmount))
      expect(await vault.totalAssets()).to.eq(originalTotalCollateral.add(fundingAmount))
    })

    it('rounds deposits correctly', async () => {
      const collateralDifference = async () => {
        return (await longCollateralInVault()).sub(await shortCollateralInVault()).abs()
      }
      const btcCollateralDifference = async () => {
        return (await btcLongCollateralInVault()).sub(await btcShortCollateralInVault()).abs()
      }
      const oddDepositAmount = utils.parseEther('10000').add(1) // 10K + 1 wei

      await vault.connect(user).deposit(oddDepositAmount, user.address)
      await updateOracle()
      await vault.sync()
      expect(await collateralDifference()).to.equal(0)
      expect(await btcCollateralDifference()).to.equal(0)
      expect(await asset.balanceOf(vault.address)).to.equal(1)

      await vault.connect(user).deposit(oddDepositAmount, user.address)
      await updateOracle()
      await vault.sync()
      expect(await collateralDifference()).to.equal(0)
      expect(await btcCollateralDifference()).to.equal(0)
    })

    it('deposit on behalf', async () => {
      const largeDeposit = utils.parseEther('10000')
      await vault.connect(liquidator).deposit(largeDeposit, user.address)
      await updateOracle()

      await vault.sync()
      expect(await vault.balanceOf(user.address)).to.equal(utils.parseEther('10000'))
      expect(await vault.totalSupply()).to.equal(utils.parseEther('10000'))

      await expect(vault.connect(liquidator).redeem(utils.parseEther('10000'), user.address)).to.revertedWithPanic(
        '0x11',
      )

      await vault.connect(user).approve(liquidator.address, utils.parseEther('10000'))

      // User 2 should not be able to withdraw; they haven't deposited anything.
      await vault.connect(liquidator).redeem(utils.parseEther('10000'), user.address)
      await updateOracle()
      await vault.sync()

      // We should have withdrawn all of our collateral.
      const fundingAmount = BigNumber.from('824128844013458')
      await vault.connect(user).claim(user.address)
      expect(await totalCollateralInVault()).to.equal(0)
      expect(await vault.totalAssets()).to.equal(0)
      expect(await asset.balanceOf(liquidator.address)).to.equal(utils.parseEther('190000'))
      expect(await asset.balanceOf(user.address)).to.equal(utils.parseEther('210000').add(fundingAmount))
    })

    it('redeem on behalf', async () => {
      const largeDeposit = utils.parseEther('10000')
      await vault.connect(user).deposit(largeDeposit, user.address)
      await updateOracle()

      await vault.sync()
      expect(await vault.balanceOf(user.address)).to.equal(utils.parseEther('10000'))
      expect(await vault.totalSupply()).to.equal(utils.parseEther('10000'))

      await expect(vault.connect(liquidator).redeem(utils.parseEther('10000'), user.address)).to.revertedWithPanic(
        '0x11',
      )

      await vault.connect(user).approve(liquidator.address, utils.parseEther('10000'))

      // User 2 should not be able to withdraw; they haven't deposited anything.
      await vault.connect(liquidator).redeem(utils.parseEther('10000'), user.address)
      await updateOracle()
      await vault.sync()

      // We should have withdrawn all of our collateral.
      const fundingAmount = BigNumber.from('824128844013458')
      await vault.connect(user).claim(user.address)
      expect(await totalCollateralInVault()).to.equal(0)
      expect(await asset.balanceOf(user.address)).to.equal(utils.parseEther('200000').add(fundingAmount))
    })

    it('close to makerLimit', async () => {
      // Get maker product very close to the makerLimit
      await asset.connect(perennialUser).approve(collateral.address, constants.MaxUint256)
      await collateral
        .connect(perennialUser)
        .depositTo(perennialUser.address, short.address, utils.parseEther('400000'))
      await short.connect(perennialUser).openMake(utils.parseEther('480'))
      await updateOracle()
      await vault.sync()

      // Deposit should create a greater position than what's available
      const largeDeposit = utils.parseEther('10000')
      await vault.connect(user).deposit(largeDeposit, user.address)
      await updateOracle()
      await vault.sync()

      // Now we should have opened positions.
      // The positions should be equal to (smallDeposit + largeDeposit) * leverage / 2 / originalOraclePrice.
      expect(await longPosition()).to.equal(largeDeposit.mul(leverage).mul(4).div(5).div(2).div(originalOraclePrice))
      const makerLimitDelta = BigNumber.from('8282802043703935198')
      expect(await shortPosition()).to.equal(makerLimitDelta)
      expect(await btcLongPosition()).to.equal(largeDeposit.mul(leverage).div(5).div(2).div(btcOriginalOraclePrice))
      expect(await btcShortPosition()).to.equal(largeDeposit.mul(leverage).div(5).div(2).div(btcOriginalOraclePrice))
    })

    it('exactly at makerLimit', async () => {
      // Get maker product very close to the makerLimit
      await asset.connect(perennialUser).approve(collateral.address, constants.MaxUint256)
      await collateral
        .connect(perennialUser)
        .depositTo(perennialUser.address, short.address, utils.parseEther('400000'))
      const makerAvailable = (await short.makerLimit()).sub(
        (await short.positionAtVersion(await short['latestVersion()']())).maker,
      )

      await short.connect(perennialUser).openMake(makerAvailable)
      await updateOracle()
      await vault.sync()

      // Deposit should create a greater position than what's available
      const largeDeposit = utils.parseEther('10000')
      await vault.connect(user).deposit(largeDeposit, user.address)
      await updateOracle()
      await vault.sync()

      // Now we should have opened positions.
      // The positions should be equal to (smallDeposit + largeDeposit) * leverage / 2 / originalOraclePrice.
      expect(await longPosition()).to.equal(largeDeposit.mul(leverage).mul(4).div(5).div(2).div(originalOraclePrice))
      expect(await shortPosition()).to.equal(0)
      expect(await btcLongPosition()).to.equal(largeDeposit.mul(leverage).div(5).div(2).div(btcOriginalOraclePrice))
      expect(await btcShortPosition()).to.equal(largeDeposit.mul(leverage).div(5).div(2).div(btcOriginalOraclePrice))
    })

    it('close to taker', async () => {
      // Deposit should create a greater position than what's available
      const largeDeposit = utils.parseEther('10000')
      await vault.connect(user).deposit(largeDeposit, user.address)
      await updateOracle()
      await vault.sync()

      // Get taker product very close to the maker
      await asset.connect(perennialUser).approve(collateral.address, constants.MaxUint256)
      await collateral
        .connect(perennialUser)
        .depositTo(perennialUser.address, short.address, utils.parseEther('1000000'))
      await short.connect(perennialUser).openTake(utils.parseEther('1280'))
      await updateOracle()
      await vault.sync()

      // Redeem should create a slightly greater position delta than what's available
      await vault.connect(user).redeem(await vault.maxRedeem(user.address), user.address)
      await updateOracle()
      await vault.sync()

      const takerMinimum = BigNumber.from('6692251470872433151')
      expect(await shortPosition()).to.equal(takerMinimum)
      expect((await short.positionAtVersion(await short['latestVersion()']()))[0]).to.equal(
        (await short.positionAtVersion(await short['latestVersion()']()))[1],
      )
    })

    it('product closing closes all positions', async () => {
      const largeDeposit = utils.parseEther('10000')
      await vault.connect(user).deposit(largeDeposit, user.address)
      await updateOracleAndSync()

      expect(await longPosition()).to.be.greaterThan(0)
      expect(await shortPosition()).to.be.greaterThan(0)
      expect(await btcLongPosition()).to.be.greaterThan(0)
      expect(await btcShortPosition()).to.be.greaterThan(0)
      const productOwner = await impersonate.impersonateWithBalance(
        await controller['owner(address)'](long.address),
        utils.parseEther('10'),
      )
      await long.connect(productOwner).updateClosed(true)
      await btcLong.connect(owner).updateClosed(true)
      await updateOracleAndSync()
      await updateOracleAndSync()

      // We should have closed all positions
      expect(await longPosition()).to.equal(0)
      expect(await shortPosition()).to.equal(0)
      expect(await btcLongPosition()).to.equal(0)
      expect(await btcShortPosition()).to.equal(0)

      await long.connect(productOwner).updateClosed(false)
      await btcLong.connect(owner).updateClosed(false)
      await updateOracleAndSync()
      await updateOracleAndSync()

      // Positions should be opened back up again
      expect(await longPosition()).to.be.greaterThan(0)
      expect(await shortPosition()).to.be.greaterThan(0)
      expect(await btcLongPosition()).to.be.greaterThan(0)
      expect(await btcShortPosition()).to.be.greaterThan(0)
    })

    context('liquidation', () => {
      context('long', () => {
        it('recovers before being liquidated', async () => {
          await vault.connect(user).deposit(utils.parseEther('100000'), user.address)
          await updateOracle()

          // 1. An oracle update makes the long position liquidatable.
          // We should now longer be able to deposit or redeem
          await updateOracle(utils.parseEther('4000'))

          await expect(vault.connect(user).deposit(2, user.address)).to.revertedWithCustomError(
            vault,
            'BalancedVaultDepositLimitExceeded',
          )
          await expect(vault.connect(user).redeem(2, user.address)).to.revertedWithCustomError(
            vault,
            'BalancedVaultRedemptionLimitExceeded',
          )

          // 2. Settle accounts.
          // We should still not be able to deposit.
          await long.connect(user).settleAccount(vault.address)
          await short.connect(user).settleAccount(vault.address)
          expect(await vault.maxDeposit(user.address)).to.equal(0)
          await expect(vault.connect(user).deposit(2, user.address)).to.revertedWithCustomError(
            vault,
            'BalancedVaultDepositLimitExceeded',
          )
          await expect(vault.connect(user).redeem(2, user.address)).to.revertedWithCustomError(
            vault,
            'BalancedVaultRedemptionLimitExceeded',
          )

          // 3. Sync the vault before it has a chance to get liquidated, it will work and no longer be liquidatable
          // We should still be able to deposit.
          await vault.sync()
          expect(await vault.maxDeposit(user.address)).to.equal('401972181441895951577804')
          await vault.connect(user).deposit(2, user.address)
        })

        it('recovers from a liquidation', async () => {
          await vault.connect(user).deposit(utils.parseEther('100000'), user.address)
          await updateOracle()

          // 1. An oracle update makes the long position liquidatable.
          // We should now longer be able to deposit or redeem
          await updateOracle(utils.parseEther('4000'))

          await expect(vault.connect(user).deposit(2, user.address)).to.revertedWithCustomError(
            vault,
            'BalancedVaultDepositLimitExceeded',
          )
          await expect(vault.connect(user).redeem(2, user.address)).to.revertedWithCustomError(
            vault,
            'BalancedVaultRedemptionLimitExceeded',
          )

          // 2. Settle accounts.
          // We should still not be able to deposit or redeem.
          await long.connect(user).settleAccount(vault.address)
          await short.connect(user).settleAccount(vault.address)
          expect(await vault.maxDeposit(user.address)).to.equal(0)
          await expect(vault.connect(user).deposit(2, user.address)).to.revertedWithCustomError(
            vault,
            'BalancedVaultDepositLimitExceeded',
          )
          await expect(vault.connect(user).redeem(2, user.address)).to.revertedWithCustomError(
            vault,
            'BalancedVaultRedemptionLimitExceeded',
          )

          // 4. Liquidate the long position.
          // We should still not be able to deposit or redeem.
          await collateral.connect(liquidator).liquidate(vault.address, long.address)
          expect(await vault.maxDeposit(user.address)).to.equal(0)
          await expect(vault.connect(user).deposit(2, user.address)).to.revertedWithCustomError(
            vault,
            'BalancedVaultDepositLimitExceeded',
          )
          await expect(vault.connect(user).redeem(2, user.address)).to.revertedWithCustomError(
            vault,
            'BalancedVaultRedemptionLimitExceeded',
          )

          // 5. Settle the liquidation.
          // We now be able to deposit.
          await updateOracle(utils.parseEther('3000'))
          await vault.connect(user).deposit(2, user.address)

          await updateOracle()
          await vault.sync()

          const finalPosition = BigNumber.from('50707668091779666592')
          const finalCollateral = BigNumber.from('38030753919602731122977')
          const btcFinalPosition = BigNumber.from('1633897468743456266')
          const btcFinalCollateral = BigNumber.from('9507688479900682780744')
          expect(await longPosition()).to.equal(finalPosition)
          expect(await shortPosition()).to.equal(finalPosition)
          expect(await longCollateralInVault()).to.equal(finalCollateral)
          expect(await shortCollateralInVault()).to.equal(finalCollateral)
          expect(await btcLongPosition()).to.equal(btcFinalPosition)
          expect(await btcShortPosition()).to.equal(btcFinalPosition)
          expect(await btcLongCollateralInVault()).to.equal(btcFinalCollateral)
          expect(await btcShortCollateralInVault()).to.equal(btcFinalCollateral)
        })
      })

      context('short', () => {
        beforeEach(async () => {
          // get utilization closer to target in order to trigger pnl on price deviation
          await asset.connect(perennialUser).approve(collateral.address, constants.MaxUint256)
          await collateral
            .connect(perennialUser)
            .depositTo(perennialUser.address, long.address, utils.parseEther('120000'))
          await long.connect(perennialUser).openTake(utils.parseEther('700'))
          await collateral
            .connect(perennialUser)
            .depositTo(perennialUser.address, short.address, utils.parseEther('280000'))
          await short.connect(perennialUser).openTake(utils.parseEther('1100'))
          await updateOracle()
          await vault.sync()
        })

        it('recovers before being liquidated', async () => {
          await vault.connect(user).deposit(utils.parseEther('100000'), user.address)
          await updateOracle()

          // 1. An oracle update makes the short position liquidatable.
          // We should now longer be able to deposit or redeem
          await updateOracle(utils.parseEther('1200'))

          await expect(vault.connect(user).deposit(2, user.address)).to.revertedWithCustomError(
            vault,
            'BalancedVaultDepositLimitExceeded',
          )
          await expect(vault.connect(user).redeem(2, user.address)).to.revertedWithCustomError(
            vault,
            'BalancedVaultRedemptionLimitExceeded',
          )

          // 2. Settle accounts.
          // We should still not be able to deposit.
          await long.connect(user).settleAccount(vault.address)
          await short.connect(user).settleAccount(vault.address)
          expect(await vault.maxDeposit(user.address)).to.equal(0)
          await expect(vault.connect(user).deposit(2, user.address)).to.revertedWithCustomError(
            vault,
            'BalancedVaultDepositLimitExceeded',
          )
          await expect(vault.connect(user).redeem(2, user.address)).to.revertedWithCustomError(
            vault,
            'BalancedVaultRedemptionLimitExceeded',
          )

          // 3. Sync the vault before it has a chance to get liquidated, it will work and no longer be liquidatable
          // We should still be able to deposit.
          await vault.sync()
          expect(await vault.maxDeposit(user.address)).to.equal('396777266765732414363890')
          await vault.connect(user).deposit(2, user.address)
        })

        it('recovers from a liquidation', async () => {
          await vault.connect(user).deposit(utils.parseEther('100000'), user.address)
          await updateOracle()

          // 1. An oracle update makes the long position liquidatable.
          // We should now longer be able to deposit or redeem
          await updateOracle(utils.parseEther('1200'))

          await expect(vault.connect(user).deposit(2, user.address)).to.revertedWithCustomError(
            vault,
            'BalancedVaultDepositLimitExceeded',
          )
          await expect(vault.connect(user).redeem(2, user.address)).to.revertedWithCustomError(
            vault,
            'BalancedVaultRedemptionLimitExceeded',
          )

          // 2. Settle accounts.
          // We should still not be able to deposit or redeem.
          await long.connect(user).settleAccount(vault.address)
          await short.connect(user).settleAccount(vault.address)
          expect(await vault.maxDeposit(user.address)).to.equal(0)
          await expect(vault.connect(user).deposit(2, user.address)).to.revertedWithCustomError(
            vault,
            'BalancedVaultDepositLimitExceeded',
          )
          await expect(vault.connect(user).redeem(2, user.address)).to.revertedWithCustomError(
            vault,
            'BalancedVaultRedemptionLimitExceeded',
          )

          // 4. Liquidate the long position.
          // We should still not be able to deposit or redeem.
          await collateral.connect(liquidator).liquidate(vault.address, short.address)
          expect(await vault.maxDeposit(user.address)).to.equal(0)
          await expect(vault.connect(user).deposit(2, user.address)).to.revertedWithCustomError(
            vault,
            'BalancedVaultDepositLimitExceeded',
          )
          await expect(vault.connect(user).redeem(2, user.address)).to.revertedWithCustomError(
            vault,
            'BalancedVaultRedemptionLimitExceeded',
          )

          // 5. Settle the liquidation.
          // We now be able to deposit.
          await updateOracle()
          await vault.connect(user).deposit(2, user.address)

          await updateOracle()
          await vault.sync()

          const finalPosition = BigNumber.from('136109459011782740553')
          const finalCollateral = BigNumber.from('40832846402925697101225')
          const btcFinalPosition = BigNumber.from('1754282213481988093')
          const btcFinalCollateral = BigNumber.from('10208211600731424275306')
          expect(await longPosition()).to.equal(finalPosition)
          expect(await shortPosition()).to.equal(finalPosition)
          expect(await longCollateralInVault()).to.equal(finalCollateral)
          expect(await shortCollateralInVault()).to.equal(finalCollateral)
          expect(await btcLongPosition()).to.equal(btcFinalPosition)
          expect(await btcShortPosition()).to.equal(btcFinalPosition)
          expect(await btcLongCollateralInVault()).to.equal(btcFinalCollateral)
          expect(await btcShortCollateralInVault()).to.equal(btcFinalCollateral)
        })
      })
    })

    context('insolvency', () => {
      beforeEach(async () => {
        // get utilization closer to target in order to trigger pnl on price deviation
        await asset.connect(perennialUser).approve(collateral.address, constants.MaxUint256)
        await collateral
          .connect(perennialUser)
          .depositTo(perennialUser.address, long.address, utils.parseEther('120000'))
        await long.connect(perennialUser).openTake(utils.parseEther('700'))
        await updateOracle()
        await vault.sync()
      })

      it('gracefully unwinds upon insolvency', async () => {
        // 1. Deposit initial amount into the vault
        await vault.connect(user).deposit(utils.parseEther('100000'), user.address)
        await updateOracle()
        await vault.sync()

        // 2. Redeem most of the amount, but leave it unclaimed
        await vault.connect(user).redeem(utils.parseEther('80000'), user.address)
        await updateOracle()
        await vault.sync()

        // 3. An oracle update makes the long position liquidatable, initiate take close
        await updateOracle(utils.parseEther('20000'))
        await long.connect(user).settleAccount(vault.address)
        await short.connect(user).settleAccount(vault.address)
        await long.connect(perennialUser).closeTake(utils.parseEther('700'))
        await collateral.connect(liquidator).liquidate(vault.address, long.address)

        // // 4. Settle the vault to recover and rebalance
        await updateOracle() // let take settle at high price
        await updateOracle(utils.parseEther('1500')) // return to normal price to let vault rebalance
        await vault.sync()
        await updateOracle()
        await vault.sync()

        // 5. Vault should no longer have enough collateral to cover claims, pro-rata claim should be enabled
        const finalPosition = BigNumber.from('0')
        const finalCollateral = BigNumber.from('23959832378187916303296')
        const btcFinalPosition = BigNumber.from('0')
        const btcFinalCollateral = BigNumber.from('5989958094546979075824')
        const finalUnclaimed = BigNumber.from('80000022114229307040353')
        expect(await longPosition()).to.equal(finalPosition)
        expect(await shortPosition()).to.equal(finalPosition)
        expect(await longCollateralInVault()).to.equal(finalCollateral)
        expect(await shortCollateralInVault()).to.equal(finalCollateral)
        expect(await btcLongPosition()).to.equal(btcFinalPosition)
        expect(await btcShortPosition()).to.equal(btcFinalPosition)
        expect(await btcLongCollateralInVault()).to.equal(btcFinalCollateral)
        expect(await btcShortCollateralInVault()).to.equal(btcFinalCollateral)
        expect(await vault.unclaimed(user.address)).to.equal(finalUnclaimed)
        expect(await vault.totalUnclaimed()).to.equal(finalUnclaimed)
        await expect(vault.connect(user).deposit(2, user.address)).to.revertedWithCustomError(
          vault,
          'BalancedVaultDepositLimitExceeded',
        )

        // 6. Claim should be pro-rated
        const initialBalanceOf = await asset.balanceOf(user.address)
        await vault.claim(user.address)
        expect(await longCollateralInVault()).to.equal(0)
        expect(await shortCollateralInVault()).to.equal(0)
        expect(await btcLongCollateralInVault()).to.equal(0)
        expect(await btcShortCollateralInVault()).to.equal(0)
        expect(await vault.unclaimed(user.address)).to.equal(0)
        expect(await vault.totalUnclaimed()).to.equal(0)
        expect(await asset.balanceOf(user.address)).to.equal(
          initialBalanceOf.add(finalCollateral.add(btcFinalCollateral).mul(2)).add(1),
        )

        // 7. Should no longer be able to deposit, vault is closed
        await expect(vault.connect(user).deposit(2, user.address)).to.revertedWithCustomError(
          vault,
          'BalancedVaultDepositLimitExceeded',
        )
      })
    })
  })
})
