import '@nomiclabs/hardhat-ethers'
import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types'

const PREVIOUS_TOPIC_0 = ['0x09d535073bc2dc21c8fd680a2141218a65fb0acc46e88b9e5d96f114b734b004']

export default task('listProducts', 'Lists all created products').setAction(
  async (args: TaskArguments, HRE: HardhatRuntimeEnvironment) => {
    const {
      ethers,
      deployments: { get },
    } = HRE
    const controller = await ethers.getContractAt('IController', (await get('Controller_Proxy')).address)

    const address = controller.address
    const topic0s = [...PREVIOUS_TOPIC_0, controller.interface.getEventTopic('ProductCreated')]
    const events = await controller.queryFilter({ address, topics: [topic0s] })
    console.log(`Found ${events.length} products`)
    console.log(events.map(e => ethers.utils.defaultAbiCoder.decode(['address'], e.topics[1])[0]))
    console.log('done.')
  },
)
