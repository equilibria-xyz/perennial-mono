import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import HRE from 'hardhat'
import { utils } from 'ethers'

import { time, impersonate } from '../../../../common/testutil'
import {
  Factory,
  TestnetContractPayoffProvider,
  IERC20Metadata,
  ChainlinkOracle,
  Market,
  IERC20Metadata__factory,
  Factory__factory,
  TestnetContractPayoffProvider__factory,
  ChainlinkOracle__factory,
  Market__factory,
  Lens,
  Lens__factory,
  IBatcher,
  IBatcher__factory,
  ERC20PresetMinterPauser,
  ERC20PresetMinterPauser__factory,
  ProxyAdmin,
  ProxyAdmin__factory,
  TransparentUpgradeableProxy__factory,
} from '../../../types/generated'
import { ChainlinkContext } from './chainlinkHelpers'
import { buildChainlinkRoundId } from '../../../util/buildChainlinkRoundId'
import { CHAINLINK_CUSTOM_CURRENCIES } from '../../../util/constants'
import { parse6decimal } from '../../../util/number'
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
  controller: Factory
  contractPayoffProvider: TestnetContractPayoffProvider
  dsu: IERC20Metadata
  usdc: IERC20Metadata
  dsuHolder: SignerWithAddress
  usdcHolder: SignerWithAddress
  chainlink: ChainlinkContext
  chainlinkOracle: ChainlinkOracle
  marketImpl: Market
  lens: Lens
  batcher: IBatcher
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

  const controllerImpl = await new Factory__factory(owner).deploy()

  const controllerProxy = await new TransparentUpgradeableProxy__factory(owner).deploy(
    controllerImpl.address,
    proxyAdmin.address,
    [],
  )

  const controller = await new Factory__factory(owner).attach(controllerProxy.address)

  const marketImpl = await new Market__factory(owner).deploy()

  // Init
  await controller.initialize(marketImpl.address)

  // Params
  await controller.updatePauser(pauser.address)
  await controller.updateTreasury(treasuryA.address)
  await controller.updateParameter({
    protocolFee: parse6decimal('0.50'),
    minFundingFee: parse6decimal('0.10'),
    liquidationFee: parse6decimal('0.50'),
    minCollateral: parse6decimal('500'),
    paused: false,
  })

  // Set state
  const dsuHolder = await impersonate.impersonateWithBalance(DSU_HOLDER, utils.parseEther('10'))
  await dsu.connect(dsuHolder).transfer(user.address, utils.parseEther('20000'))
  await dsu.connect(dsuHolder).transfer(userB.address, utils.parseEther('20000'))
  await dsu.connect(dsuHolder).transfer(userC.address, utils.parseEther('20000'))
  await dsu.connect(dsuHolder).transfer(userD.address, utils.parseEther('20000'))
  const usdcHolder = await impersonate.impersonateWithBalance(USDC_HOLDER, utils.parseEther('10'))
  await chainlinkOracle.sync()

  const lens = await new Lens__factory(owner).deploy(controller.address)

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
    marketImpl,
    lens,
    batcher,
    rewardToken,
  }
}

export async function createMarket(
  instanceVars: InstanceVars,
  payoffProvider?: TestnetContractPayoffProvider,
  oracle?: ChainlinkOracle,
): Promise<Market> {
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
  }
  const parameter = {
    maintenance: parse6decimal('0.3'),
    fundingFee: parse6decimal('0.1'),
    makerFee: 0,
    takerFee: 0,
    positionFee: 0,
    makerLimit: parse6decimal('1'),
    closed: false,
    utilizationCurve: {
      minRate: 0,
      maxRate: parse6decimal('5.00'),
      targetRate: parse6decimal('0.80'),
      targetUtilization: parse6decimal('0.80'),
    },
    makerRewardRate: 0,
    takerRewardRate: 0,
    oracle: oracle.address,
    payoff: {
      provider: payoffProvider.address,
      short: false,
    },
  }
  const marketAddress = await controller.callStatic.createMarket(definition, parameter)
  await controller.createMarket(definition, parameter)

  const market = Market__factory.connect(marketAddress, owner)
  await market.acceptOwner()
  await market.updateTreasury(treasuryB.address)

  return market
}
