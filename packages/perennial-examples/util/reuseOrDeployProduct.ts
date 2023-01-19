import { DeploymentsExtension } from 'hardhat-deploy/types'
import { IController, IProduct, IProduct__factory } from '../types/generated'

export default async function reuseOrDeployProduct(
  { deployments: { getOrNull, save, get } }: { deployments: DeploymentsExtension },
  coordinatorId: number,
  controller: IController,
  productInfo: IProduct.ProductInfoStruct,
): Promise<void> {
  const deploymentName = `Product_${productInfo.symbol}_${
    productInfo.payoffDefinition.payoffDirection === 1 ? 'Short' : 'Long'
  }`
  let productAddress: string | undefined = (await getOrNull(deploymentName))?.address

  if (productAddress == null) {
    process.stdout.write(`creating ${deploymentName}...`)
    productAddress = await controller.callStatic.createProduct(coordinatorId, productInfo)

    const productImpl = await get('Product_Impl')
    const receipt = await (await controller.createProduct(coordinatorId, productInfo)).wait(2)
    await save(deploymentName, {
      ...productImpl,
      address: productAddress,
      receipt,
    })

    process.stdout.write(`created at address ${productAddress} with ${receipt.gasUsed} gas\n`)
  } else {
    console.log(`reusing product ${deploymentName} at ${productAddress}`)
  }
}

export { reuseOrDeployProduct }
