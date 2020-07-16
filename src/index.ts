import {test} from './test'

enum Some {
  Test,
  Enother
}

enum Test {  
  A,  
  B,  
  C = Math.floor(Math.random() * 1000),  
  D = 10,  
  E  
}

function some() {
  return Promise.resolve('hello')
}

async function main () {
  const s = await some()

  console.log(s)
}

console.log(Some)
test()
main()