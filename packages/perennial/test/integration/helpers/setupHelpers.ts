import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import HRE from 'hardhat'
import { BigNumber, utils } from 'ethers'
import { CHAINLINK_CUSTOM_CURRENCIES, buildChainlinkRoundId } from '@equilibria/perennial-oracle/util'

import { time, impersonate } from '../../../../common/testutil'
import {
  Collateral,
  Controller,
  TestnetContractPayoffProvider,
  IERC20Metadata,
  ChainlinkOracle,
  Product,
  Incentivizer,
  IBeacon,
  IERC20Metadata__factory,
  Collateral__factory,
  Controller__factory,
  TestnetContractPayoffProvider__factory,
  ChainlinkOracle__factory,
  Product__factory,
  Incentivizer__factory,
  UpgradeableBeacon__factory,
  PerennialLens,
  PerennialLens__factory,
  Forwarder,
  Forwarder__factory,
  Batcher,
  Batcher__factory,
  ERC20PresetMinterPauser,
  ERC20PresetMinterPauser__factory,
  ProxyAdmin,
  ProxyAdmin__factory,
  TransparentUpgradeableProxy__factory,
  ReservoirFeedOracle,
  MultiInvoker,
  MultiInvoker__factory,
  IEmptySetReserve,
  IEmptySetReserve__factory,
} from '../../../types/generated'
import { ChainlinkContext } from './chainlinkHelpers'
import { createPayoffDefinition } from '../../../../common/testutil/types'
const { config, deployments, ethers } = HRE

export const INITIAL_PHASE_ID = 1
export const INITIAL_AGGREGATOR_ROUND_ID = 10000
export const INITIAL_VERSION = INITIAL_AGGREGATOR_ROUND_ID - 7528 // registry's phase 1 starts at aggregatorRoundID 7528
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
  collateral: Collateral
  chainlink: ChainlinkContext
  chainlinkOracle: ChainlinkOracle
  productBeacon: IBeacon
  productImpl: Product
  multiInvoker: MultiInvoker
  incentivizer: Incentivizer
  lens: PerennialLens
  batcher: Batcher
  reserve: IEmptySetReserve
  forwarder: Forwarder
  incentiveToken: ERC20PresetMinterPauser
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
  const batcher = await Batcher__factory.connect((await deployments.get('Batcher')).address, owner)

  // Deploy protocol contracts
  const proxyAdmin = await new ProxyAdmin__factory(owner).deploy()

  const controllerImpl = await new Controller__factory(owner).deploy()
  const incentivizerImpl = await new Incentivizer__factory(owner).deploy()
  const collateralImpl = await new Collateral__factory(owner).deploy(dsu.address)

  const controllerProxy = await new TransparentUpgradeableProxy__factory(owner).deploy(
    controllerImpl.address,
    proxyAdmin.address,
    [],
  )
  const incentivizerProxy = await new TransparentUpgradeableProxy__factory(owner).deploy(
    incentivizerImpl.address,
    proxyAdmin.address,
    [],
  )

  const collateralProxy = await new TransparentUpgradeableProxy__factory(owner).deploy(
    collateralImpl.address,
    proxyAdmin.address,
    [],
  )

  const controller = await new Controller__factory(owner).attach(controllerProxy.address)
  const incentivizer = await new Incentivizer__factory(owner).attach(incentivizerProxy.address)
  const collateral = await new Collateral__factory(owner).attach(collateralProxy.address)

  const productImpl = await new Product__factory(owner).deploy()
  const productBeacon = await new UpgradeableBeacon__factory(owner).deploy(productImpl.address)

  // Init
  await incentivizer.initialize(controller.address)
  await controller.initialize(collateral.address, incentivizer.address, productBeacon.address)
  await collateral.initialize(controller.address)

  // Setup MultiInvoker
  const reserve = IEmptySetReserve__factory.connect(await batcher.RESERVE(), owner)
  const multiInvokerImpl = await new MultiInvoker__factory(owner).deploy(
    usdc.address,
    batcher.address,
    reserve.address,
    controllerProxy.address,
  )
  const multiInvokerProxy = await new TransparentUpgradeableProxy__factory(owner).deploy(
    multiInvokerImpl.address,
    proxyAdmin.address,
    [],
  )
  const multiInvoker = await new MultiInvoker__factory(owner).attach(multiInvokerProxy.address)
  await multiInvoker.initialize()

  // Params - TODO: finalize before launch
  await controller.updatePauser(pauser.address)
  await controller.updateCoordinatorTreasury(0, treasuryA.address)
  await controller.updateProtocolFee(utils.parseEther('0.50'))
  await controller.updateMinFundingFee(utils.parseEther('0.10'))
  await controller.updateLiquidationFee(utils.parseEther('0.50'))
  await controller.updateIncentivizationFee(utils.parseEther('0.00'))
  await controller.updateMinCollateral(utils.parseEther('500'))
  await controller.updateProgramsPerProduct(2)
  await controller.updateMultiInvoker(multiInvoker.address)

  // Set state
  const { dsuHolder, usdcHolder } = await setupTokenHolders(dsu, [user, userB, userC, userD])
  await chainlinkOracle.sync()

  const lens = await new PerennialLens__factory(owner).deploy(controller.address)

  const forwarder = await new Forwarder__factory(owner).deploy(
    usdc.address,
    dsu.address,
    batcher.address,
    collateral.address,
  )

  const incentiveToken = await new ERC20PresetMinterPauser__factory(owner).deploy('Incentive Token', 'ITKN')

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
    contractPayoffProvider,
    dsu,
    usdc,
    usdcHolder,
    proxyAdmin,
    controller,
    productBeacon,
    productImpl,
    multiInvoker,
    incentivizer,
    collateral,
    lens,
    batcher,
    reserve,
    forwarder,
    incentiveToken,
  }
}

export async function createProduct(
  instanceVars: InstanceVars,
  payoffProvider?: TestnetContractPayoffProvider,
  oracle?: ChainlinkOracle | ReservoirFeedOracle,
): Promise<Product> {
  const { owner, controller, treasuryB, chainlinkOracle } = instanceVars
  if (!payoffProvider) {
    payoffProvider = instanceVars.contractPayoffProvider
  }
  if (!oracle) {
    oracle = chainlinkOracle
  }

  await controller.createCoordinator()
  await controller.updateCoordinatorTreasury(1, treasuryB.address)

  const productInfo = {
    name: 'Squeeth',
    symbol: 'SQTH',
    payoffDefinition: createPayoffDefinition({ contractAddress: payoffProvider.address }),
    oracle: oracle.address,
    maintenance: utils.parseEther('0.3'),
    fundingFee: utils.parseEther('0.1'),
    makerFee: 0,
    takerFee: 0,
    positionFee: 0,
    makerLimit: utils.parseEther('1'),
    utilizationCurve: {
      minRate: 0,
      maxRate: utils.parseEther('5.00'),
      targetRate: utils.parseEther('0.80'),
      targetUtilization: utils.parseEther('0.80'),
    },
  }
  const productAddress = await controller.callStatic.createProduct(1, productInfo)
  await controller.createProduct(1, productInfo)

  return Product__factory.connect(productAddress, owner)
}

export async function createIncentiveProgram(
  instanceVars: InstanceVars,
  product: Product,
  nonProtocol = false,
  amount = { maker: utils.parseEther('8000'), taker: utils.parseEther('2000') },
): Promise<BigNumber> {
  const { controller, owner, userC, incentivizer, incentiveToken } = instanceVars
  let programOwner = owner
  let coordinatorId = 0
  if (nonProtocol) {
    programOwner = userC
    coordinatorId = 1
    await controller.updateCoordinatorPendingOwner(1, userC.address)
    await controller.connect(userC).acceptCoordinatorOwner(1)
  }
  await incentiveToken.mint(programOwner.address, amount.maker.add(amount.taker))
  await incentiveToken.connect(programOwner).approve(incentivizer.address, amount.maker.add(amount.taker))

  const latestVersion = await product['latestVersion()']()
  const oracleVersion = await product.atVersion(latestVersion)
  const programInfo = {
    coordinatorId,
    token: incentiveToken.address,
    amount,
    start: oracleVersion.timestamp.add(10),
    duration: 60 * 60 * 24 * 30 * 12 * 1.5,
  }

  const timestampDiference = (await time.currentBlockTimestamp()) - oracleVersion.timestamp.toNumber()
  await time.increase(-1 * (timestampDiference + 10))
  const returnValue = await incentivizer.connect(programOwner).callStatic.create(product.address, programInfo)
  await incentivizer.connect(programOwner).create(product.address, programInfo)
  await time.increase(timestampDiference + 10)
  return returnValue
}

export async function depositTo(
  instanceVars: InstanceVars,
  user: SignerWithAddress,
  product: Product,
  position: BigNumber,
): Promise<void> {
  const { dsu, collateral } = instanceVars
  await dsu.connect(user).approve(collateral.address, position)
  await collateral.connect(user).depositTo(user.address, product.address, position)
}

export async function setupTokenHolders(
  dsu: IERC20Metadata,
  users: SignerWithAddress[],
): Promise<{ dsuHolder: SignerWithAddress; usdcHolder: SignerWithAddress }> {
  const dsuHolder = await impersonate.impersonateWithBalance(DSU_HOLDER, utils.parseEther('10'))
  await Promise.all(
    users.map(async user => {
      await dsu.connect(dsuHolder).transfer(user.address, utils.parseEther('20000'))
    }),
  )
  const usdcHolder = await impersonate.impersonateWithBalance(USDC_HOLDER, utils.parseEther('10'))

  return { dsuHolder, usdcHolder }
}
