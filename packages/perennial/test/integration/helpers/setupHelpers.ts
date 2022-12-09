import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import HRE from 'hardhat'
import { BigNumber, utils } from 'ethers'
import { CHAINLINK_CUSTOM_CURRENCIES, buildChainlinkRoundId } from '@equilibria/perennial-oracle/util'

import { time, impersonate } from '../../../../common/testutil'
import {
  Controller,
  TestnetContractPayoffProvider,
  IERC20Metadata,
  ChainlinkOracle,
  Product,
  IBeacon,
  IERC20Metadata__factory,
  Controller__factory,
  TestnetContractPayoffProvider__factory,
  ChainlinkOracle__factory,
  Product__factory,
  UpgradeableBeacon__factory,
  PerennialLens,
  PerennialLens__factory,
  Forwarder,
  Forwarder__factory,
  IBatcher,
  IBatcher__factory,
  ERC20PresetMinterPauser,
  ERC20PresetMinterPauser__factory,
  ProxyAdmin,
  ProxyAdmin__factory,
  TransparentUpgradeableProxy__factory,
  ReservoirFeedOracle,
} from '../../../types/generated'
import { ChainlinkContext } from './chainlinkHelpers'
import { createPayoffDefinition } from '../../../../common/testutil/types'
const { config, deployments, ethers } = HRE

export const INITIAL_PHASE_ID = 1
export const INITIAL_AGGREGATOR_ROUND_ID = 10000
export const INITIAL_VERSION = 2472 // registry's phase 1 starts at aggregatorRoundID 7528
export const DSU_HOLDER = '0x0B663CeaCEF01f2f88EB7451C70Aa069f19dB997'
export const USDC_HOLDER = '0x0A59649758aa4d66E25f08Dd01271e891fe52199'

export interface InstanceVars {
  owner: SignerWithAddress
  pauser: SignerWithAddress
  user: SignerWithAddress
  userB: SignerWithAddress
  userC: SignerWithAddress
  userD: SignerWithAddress
  treasuryA: SignerWithAddress
  treasuryB: SignerWithAddress
  proxyAdmin: ProxyAdmin
  controller: Controller
  contractPayoffProvider: TestnetContractPayoffProvider
  dsu: IERC20Metadata
  usdc: IERC20Metadata
  dsuHolder: SignerWithAddress
  usdcHolder: SignerWithAddress
  chainlink: ChainlinkContext
  chainlinkOracle: ChainlinkOracle
  productBeacon: IBeacon
  productImpl: Product
  lens: PerennialLens
  batcher: IBatcher
  forwarder: Forwarder
  rewardToken: ERC20PresetMinterPauser
}

export async function deployProtocol(): Promise<InstanceVars> {
  await time.reset(config)
  const [owner, pauser, user, userB, userC, userD, treasuryA, treasuryB] = await ethers.getSigners()

  // Deploy external deps
  const initialRoundId = buildChainlinkRoundId(INITIAL_PHASE_ID, INITIAL_AGGREGATOR_ROUND_ID)
  const chainlink = await new ChainlinkContext(
    CHAINLINK_CUSTOM_CURRENCIES.ETH,
    CHAINLINK_CUSTOM_CURRENCIES.USD,
    initialRoundId,
  ).init()
  const chainlinkOracle = await new ChainlinkOracle__factory(owner).deploy(
    chainlink.feedRegistry.address,
    CHAINLINK_CUSTOM_CURRENCIES.ETH,
    CHAINLINK_CUSTOM_CURRENCIES.USD,
  )
  const contractPayoffProvider = await new TestnetContractPayoffProvider__factory(owner).deploy()
  const dsu = await IERC20Metadata__factory.connect((await deployments.get('DSU')).address, owner)
  const usdc = await IERC20Metadata__factory.connect((await deployments.get('USDC')).address, owner)
  const batcher = await IBatcher__factory.connect((await deployments.get('Batcher')).address, owner)

  // Deploy protocol contracts
  const proxyAdmin = await new ProxyAdmin__factory(owner).deploy()

  const controllerImpl = await new Controller__factory(owner).deploy()

  const controllerProxy = await new TransparentUpgradeableProxy__factory(owner).deploy(
    controllerImpl.address,
    proxyAdmin.address,
    [],
  )

  const controller = await new Controller__factory(owner).attach(controllerProxy.address)

  const productImpl = await new Product__factory(owner).deploy()
  const productBeacon = await new UpgradeableBeacon__factory(owner).deploy(productImpl.address)

  // Init
  await controller.initialize(productBeacon.address)

  // Params - TODO: finalize before launch
  await controller.updatePauser(pauser.address)
  await controller.updateTreasury(treasuryA.address)
  await controller.updateParameter({
    protocolFee: utils.parseEther('0.50'),
    minFundingFee: utils.parseEther('0.10'),
    minCollateral: utils.parseEther('500'),
    paused: false,
  })
  await controller.updateLiquidationFee(utils.parseEther('0.50'))

  // Set state
  const dsuHolder = await impersonate.impersonateWithBalance(DSU_HOLDER, utils.parseEther('10'))
  await dsu.connect(dsuHolder).transfer(user.address, utils.parseEther('20000'))
  await dsu.connect(dsuHolder).transfer(userB.address, utils.parseEther('20000'))
  await dsu.connect(dsuHolder).transfer(userC.address, utils.parseEther('20000'))
  await dsu.connect(dsuHolder).transfer(userD.address, utils.parseEther('20000'))
  const usdcHolder = await impersonate.impersonateWithBalance(USDC_HOLDER, utils.parseEther('10'))
  await chainlinkOracle.sync()

  const lens = await new PerennialLens__factory(owner).deploy(controller.address)

  const forwarder = await new Forwarder__factory(owner).deploy(usdc.address, dsu.address, batcher.address)

  const rewardToken = await new ERC20PresetMinterPauser__factory(owner).deploy('Incentive Token', 'ITKN')

  return {
    owner,
    pauser,
    user,
    userB,
    userC,
    userD,
    treasuryA,
    treasuryB,
    dsuHolder,
    chainlink,
    chainlinkOracle,
    contractPayoffProvider: contractPayoffProvider,
    dsu,
    usdc,
    usdcHolder,
    proxyAdmin,
    controller,
    productBeacon,
    productImpl,
    lens,
    batcher,
    forwarder,
    rewardToken,
  }
}

export async function createProduct(
  instanceVars: InstanceVars,
  payoffProvider?: TestnetContractPayoffProvider,
  oracle?: ChainlinkOracle | ReservoirFeedOracle,
): Promise<Product> {
  const { owner, controller, treasuryB, chainlinkOracle, rewardToken, dsu } = instanceVars
  if (!payoffProvider) {
    payoffProvider = instanceVars.contractPayoffProvider
  }
  if (!oracle) {
    oracle = chainlinkOracle
  }

  const definition = {
    name: 'Squeeth',
    symbol: 'SQTH',
    token: dsu.address,
    reward: rewardToken.address,
    payoffDefinition: createPayoffDefinition({ contractAddress: payoffProvider.address }),
    oracle: oracle.address,
  }
  const parameter = {
    maintenance: utils.parseEther('0.3'),
    fundingFee: utils.parseEther('0.1'),
    makerFee: 0,
    takerFee: 0,
    positionFee: 0,
    makerLimit: utils.parseEther('1'),
    closed: false,
    utilizationCurve: {
      minRate: 0,
      maxRate: utils.parseEther('5.00'),
      targetRate: utils.parseEther('0.80'),
      targetUtilization: utils.parseEther('0.80'),
    },
    rewardRate: {
      maker: 0,
      taker: 0,
    },
  }
  const productAddress = await controller.callStatic.createProduct(definition, parameter)
  await controller.createProduct(definition, parameter)

  const product = Product__factory.connect(productAddress, owner)
  await product.acceptOwner()
  await product.updateTreasury(treasuryB.address)

  return product
}

export async function depositTo(
  instanceVars: InstanceVars,
  user: SignerWithAddress,
  product: Product,
  position: BigNumber,
): Promise<void> {
  const { dsu } = instanceVars
  await dsu.connect(user).approve(product.address, position)
  await product.connect(user).update(0, position)
}
