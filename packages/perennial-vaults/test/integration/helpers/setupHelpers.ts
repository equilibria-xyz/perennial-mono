import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BigNumberish, utils } from 'ethers'
import { createPayoffDefinition } from '../../../../common/testutil/types'
import { ChainlinkOracle__factory, IController__factory, IProduct } from '../../../types/generated'
import { JumpRateUtilizationCurveStruct } from '../../../types/generated/@equilibria/perennial/contracts/interfaces/IProduct'

export interface DeployProductParams {
  owner: SignerWithAddress
  productName: string
  productSymbol: string
  baseCurrency: string
  quoteCurrency: string
  short: boolean
  maintenance?: BigNumberish
  fundingFee?: BigNumberish
  takerFee?: BigNumberish
  positionFee?: BigNumberish
  makerLimit?: BigNumberish
  utilizationCurve?: JumpRateUtilizationCurveStruct
}

// Deploys a product that uses an oracle based on an oracle in the Chainlink feed registry.
// Returns the address of the deployed product.
export async function deployProductOnMainnetFork(params: DeployProductParams): Promise<string> {
  const chainlinkFeedRegistry = '0x47Fb2585D2C56Fe188D0E6ec628a38b74fCeeeDf'
  const oracle = await new ChainlinkOracle__factory(params.owner).deploy(
    chainlinkFeedRegistry,
    params.baseCurrency,
    params.quoteCurrency,
  )

  const productInfo: IProduct.ProductInfoStruct = {
    name: params.productName,
    symbol: params.productSymbol,
    payoffDefinition: createPayoffDefinition({ short: params.short }),
    oracle: oracle.address,
    maintenance: params.maintenance ?? utils.parseEther('0.5'),
    fundingFee: params.fundingFee ?? utils.parseEther('0.10'),
    makerFee: utils.parseEther('0.0'),
    takerFee: utils.parseEther('0.0'),
    positionFee: params.positionFee ?? utils.parseEther('0.5'),
    makerLimit: params.makerLimit ?? utils.parseEther('100'),
    utilizationCurve: params.utilizationCurve ?? {
      // Force a 0.10 rate to make tests simpler
      minRate: utils.parseEther('0.10'),
      maxRate: utils.parseEther('0.10'),
      targetRate: utils.parseEther('0.10'),
      targetUtilization: utils.parseEther('1'),
    },
  }

  // This is the controller deployed on mainnet.
  const controller = IController__factory.connect('0x9df509186b6d3b7D033359f94c8b1BB5544d51b3', params.owner)

  const coordinatorId = await controller.connect(params.owner).callStatic.createCoordinator()
  await controller.connect(params.owner).createCoordinator()

  const productAddress = await controller.connect(params.owner).callStatic.createProduct(coordinatorId, productInfo)
  await controller.connect(params.owner).createProduct(coordinatorId, productInfo)

  return productAddress
}
