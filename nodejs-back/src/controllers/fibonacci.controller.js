import { Router } from "express";

export class FibonacciController {
  path = "/fibonacci";
  router = Router();
  redisClient;
  
  constructor(redisClient) {
    this.redisClient = redisClient;
    this.initializeRoutes();
  }

  initializeRoutes() {
    this.router.get(`${this.path}`, this.getFibonacciSum);
  }

  getFibonacciSum = async (req, res, next) => {
   
    const number = Math.round(Math.random() * 10_000);

    let fib = [0n, 1n];
    
    for (let i = 2; i <= number; i++) {
      fib[i] = fib[i - 2] + fib[i - 1];
    }

    const fiboSum = fib[number-1];

    console.log(`number: ${number}; fibonacci sum: ${fiboSum.toString()}`);
  
    res.send({ number, fiboSum: fiboSum.toString() });
  }
}
