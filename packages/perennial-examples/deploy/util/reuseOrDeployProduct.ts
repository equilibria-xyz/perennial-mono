import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { IController, IProduct, IProduct__factory } from '../../types/generated'

export default async function reuseOrDeployProduct(
  { deployments: { getOrNull, save } }: HardhatRuntimeEnvironment,
  coordinatorId: number,
  controller: IController,
  productInfo: IProduct.ProductInfoStruct,
): Promise<void> {
  const deploymentName = `Product_${productInfo.name}`
  let productAddress: string | undefined = (await getOrNull(deploymentName))?.address

  if (productAddress == null) {
    process.stdout.write('creating product Squeeth...')
    productAddress = await controller.callStatic.createProduct(coordinatorId, productInfo)

    const receipt = await (await controller.createProduct(coordinatorId, productInfo)).wait(2)
    await save(deploymentName, {
      address: productAddress,
      abi: IProduct__factory.abi,
      receipt,
    })

    process.stdout.write(`created at ${productAddress} with ${receipt.gasUsed} gas`)
  } else {
    console.log(`reusing product ${deploymentName} at ${productAddress}`)
  }
}
