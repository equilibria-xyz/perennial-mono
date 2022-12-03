import { expect, util } from 'chai'
import { utils, constants } from 'ethers'
import HRE from 'hardhat'
import { impersonateWithBalance } from '../../../../common/testutil/impersonate'
import { expectPositionEq } from '../../../../common/testutil/types'
import { Collateral__factory, IERC20Metadata__factory, Product } from '../../../types/generated'
import { setupTokenHolders } from '../../integration/helpers/setupHelpers'
import { Deployment } from 'hardhat-deploy/types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { time } from '../../../../common/testutil'

const { ethers, config } = HRE

const ETH_AGGREGATOR_TRANSMITTER = '0xc4b732fd121f2f3783a9ac2a6c62fd535fd13fda'
const ETH_AGGREGATOR_ADDRESS = '0x37bc7498f4ff12c19678ee8fe19d713b87f6a9e6'
const POSITION = utils.parseEther('0.01')

export default async function opensPositions(
  product: Product,
  signer: SignerWithAddress,
  deployments: { [name: string]: Deployment },
): Promise<void> {
  await time.reset(config)

  const transmitterSigner = await impersonateWithBalance(ETH_AGGREGATOR_TRANSMITTER, utils.parseEther('10'))
  const timelockSigner = await impersonateWithBalance(
    '0xA20ea565cD799e01A86548af5a2929EB7c767fC9',
    utils.parseEther('10'),
  )

  const collateral = Collateral__factory.connect(deployments['Collateral_Proxy'].address, signer)
  const dsu = IERC20Metadata__factory.connect(deployments['DSU'].address, signer)

  const [, userA, userB] = await ethers.getSigners()
  const { dsuHolder } = await setupTokenHolders(dsu, [])

  await dsu.connect(dsuHolder).approve(collateral.address, constants.MaxUint256)
  await collateral.connect(dsuHolder).depositTo(userA.address, product.address, utils.parseEther('1000'))
  await collateral.connect(dsuHolder).depositTo(userB.address, product.address, utils.parseEther('1000'))

  await product.connect(timelockSigner).updateMakerLimit(utils.parseEther('100'))

  await expect(product.connect(userA).openMake(POSITION)).to.not.be.reverted
  await expect(product.connect(userB).openTake(POSITION)).to.not.be.reverted

  const pre = await product['pre()']()
  expectPositionEq(pre.openPosition, { maker: POSITION, taker: POSITION })
  expectPositionEq(pre.closePosition, { maker: 0, taker: 0 })

  const latestVersion = await product['latestVersion()']()
  // Push a new price version to the aggregator
  await transmitterSigner.sendTransaction({
    to: ETH_AGGREGATOR_ADDRESS,
    value: 0,
    data: '0xc9807539000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000005000000000000000000000000000000000000000000000000000000000000000680010100010001000100010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004600000000000000000000000d02ee3e7b93bbe024d583e46d7fe5445000002020311100c0b070e0d051e1c12081b031d0f09141702150419061618010a00131a000000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000001f0000000000000000000000000000000000000000000000000000001d429d9b660000000000000000000000000000000000000000000000000000001d429d9b660000000000000000000000000000000000000000000000000000001d429d9b660000000000000000000000000000000000000000000000000000001d429d9b660000000000000000000000000000000000000000000000000000001d431a24b30000000000000000000000000000000000000000000000000000001d434f8c930000000000000000000000000000000000000000000000000000001d437417360000000000000000000000000000000000000000000000000000001d437417360000000000000000000000000000000000000000000000000000001d437417360000000000000000000000000000000000000000000000000000001d437417360000000000000000000000000000000000000000000000000000001d437417360000000000000000000000000000000000000000000000000000001d43876bc00000000000000000000000000000000000000000000000000000001d439284a80000000000000000000000000000000000000000000000000000001d43ab883b0000000000000000000000000000000000000000000000000000001d43ab883b0000000000000000000000000000000000000000000000000000001d43e2f9400000000000000000000000000000000000000000000000000000001d43e2f9400000000000000000000000000000000000000000000000000000001d43e2f9400000000000000000000000000000000000000000000000000000001d43e2f9400000000000000000000000000000000000000000000000000000001d44a956800000000000000000000000000000000000000000000000000000001d44a956800000000000000000000000000000000000000000000000000000001d44c7db000000000000000000000000000000000000000000000000000000001d45f3b0d00000000000000000000000000000000000000000000000000000001d575402580000000000000000000000000000000000000000000000000000001d65a33e5f0000000000000000000000000000000000000000000000000000001d65a33e5f0000000000000000000000000000000000000000000000000000001d65a33e5f0000000000000000000000000000000000000000000000000000001d669396c00000000000000000000000000000000000000000000000000000001d676936400000000000000000000000000000000000000000000000000000001d6ade38c00000000000000000000000000000000000000000000000000000001d6e636e82000000000000000000000000000000000000000000000000000000000000000b383fb99506b7aa1301f47b4b2ebec8570fc889cab95d09ec44f909081ef7985992827fe937b9ae97aa362317b49a08fbfafd1370237e20ef9ea7421c9d2021ced2d41e9d1932158a8b32978f074418bf81cb5ce947398e7594d3e1a4b50ae8f2149ee48d2bd21ec1750c8c91a7fccd477e6a8e6b0164ea1c79e87a44b7ed90851cb585c5429787614019cb29324bd23e077b8d8d3db7aea639f7e1f620eaa2e21c08d1736d07c8153facab50359dd26dacc1a72e9e161c430fcfe72660ba8ecfe5f270ae22b9ca5f4025b5d1e1721578172f2491377a0a07b73647c56928ad4aa95c82995b6f7b6170cdbc8a275c49b9a827670bb9b1d9d25227da37bdf5a0764bacd9ddf94521452283136b70c1f1e7298810bfbfeeff1ac2bfcf43e737f99a4ee61cab71ab9398e4be53b8e90d064297ca60ef353e1f41d5d6ecfc358156f2bbff97c509058605ac193c5a4a72536c5b3da2615af8bffb124c6d419767ed6e000000000000000000000000000000000000000000000000000000000000000b7adc0a263d0499eb215eb44275d2021c1b30c7b46a07cd56528cfc8c9b13abf42ad4a4fb041f3eaf71519d30101e26eab403ce43ef40d3ba6191b94abe94df8814111add28adb1ca282f68ffdcb7d2757e79248467b6474a3885fb429dda2eea4f48cfa16555bc82eebe029aa835d678eb5560fdcd5b597e782e022f039f492327d2f300db4a96c5795eb8917a4b6b09e7798458dda970b007e80b1b9ebba12d6ff00b4c5b9332726bb73b237255eb808fe00d62653294e648bd877f998e73295d5af04c8a49664cff2fcffd056dcb2541df3d91e4b389e3de97ba18098227b77020e15a2c84b798932619e2ff354dc6056787b95cfd37b5b8f4ad43561f12b001d5713703c221eb50f05a8bc75c464fdea7791ddfae2c8727fd484c9b3441d41a68a31b82eb05fb3efe46b9de1be4b5d028d91ce59a6140b8108faae2041bb43add577d26462bf33fcc942b1b60d93455099c368027f3ec989dd21e86e9624c',
  })
  await expect(product.settle()).to.not.be.reverted
  const nextVersion = await product['latestVersion()']()

  expect(nextVersion).to.equal(latestVersion.add(1))
  expectPositionEq(await product.positionAtVersion(nextVersion), {
    maker: POSITION,
    taker: POSITION,
  })

  await expect(product.settleAccount(userA.address)).to.not.be.reverted
  expect(await product['latestVersion(address)'](userA.address)).to.equal(nextVersion)
  expectPositionEq(await product.position(userA.address), { maker: POSITION, taker: 0 })

  await expect(product.settleAccount(userB.address)).to.not.be.reverted
  expect(await product['latestVersion(address)'](userB.address)).to.equal(nextVersion)
  expectPositionEq(await product.position(userB.address), { maker: 0, taker: POSITION })
}
