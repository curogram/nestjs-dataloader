import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from 'supertest';
import gql from "graphql-tag";
import { AppModule } from "./../src/app.module";
import { FactorizedAttrs, Factory } from '@jorgebodega/typeorm-factory';
import { Account } from "../src/account/account.entity";
import { DataSource } from "typeorm";

describe("AppModule", () => {
  let app: INestApplication;
  let f: Factory<Account>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    const source = app.get(DataSource);

    class AccountFactory extends Factory<Account> {
      protected entity = Account;

      protected dataSource = source;

      protected attrs(): FactorizedAttrs<Account> {
        return { name: 'name' };
      };
    }

    f = new AccountFactory();
  });

  afterAll(() => app.close());

  it("defined", () => expect(app).toBeDefined());

  it("/graphql(POST) getAccounts", async () => {
    const account = await f.create();

    const query = `
      query q($ids: [ID!]!) {
        getAccounts(ids: $ids) {
          id
        }
      }
    `;

    const result = await request(app.getHttpServer())
      .post('/graphql')
      .send({
        query,
        variables: {
          ids: [account.id],
        },
      });

    expect(result.body.errors).toBeUndefined()
  });
});
