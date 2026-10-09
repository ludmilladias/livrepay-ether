import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isValidCNPJ,
  isValidCPF,
  maskCEP,
  maskCNPJ,
  maskCPF,
  maskPhone,
  onlyDigits,
} from "./br-docs.ts";

test("onlyDigits", () => {
  assert.equal(onlyDigits("529.982.247-25"), "52998224725");
  assert.equal(onlyDigits("(11) 98888-7777"), "11988887777");
  assert.equal(onlyDigits(""), "");
});

test("isValidCPF aceita CPF válido, com ou sem máscara", () => {
  assert.equal(isValidCPF("52998224725"), true);
  assert.equal(isValidCPF("529.982.247-25"), true);
});

test("isValidCPF rejeita dígito errado, tamanho errado e sequências repetidas", () => {
  assert.equal(isValidCPF("52998224726"), false);
  assert.equal(isValidCPF("5299822472"), false);
  assert.equal(isValidCPF("529982247255"), false);
  assert.equal(isValidCPF(""), false);
  for (let d = 0; d <= 9; d++) assert.equal(isValidCPF(String(d).repeat(11)), false, `CPF ${d}x11`);
});

test("isValidCNPJ aceita CNPJ válido, com ou sem máscara", () => {
  assert.equal(isValidCNPJ("11222333000181"), true);
  assert.equal(isValidCNPJ("11.222.333/0001-81"), true);
});

test("isValidCNPJ rejeita dígito errado, tamanho errado e sequências repetidas", () => {
  assert.equal(isValidCNPJ("11222333000182"), false);
  assert.equal(isValidCNPJ("1122233300018"), false);
  assert.equal(isValidCNPJ("112223330001811"), false);
  assert.equal(isValidCNPJ(""), false);
  for (let d = 0; d <= 9; d++) assert.equal(isValidCNPJ(String(d).repeat(14)), false, `CNPJ ${d}x14`);
});

test("CPF não passa como CNPJ e vice-versa", () => {
  assert.equal(isValidCNPJ("52998224725"), false);
  assert.equal(isValidCPF("11222333000181"), false);
});

test("maskCPF é progressiva e limita a 11 dígitos", () => {
  assert.equal(maskCPF("5"), "5");
  assert.equal(maskCPF("5299"), "529.9");
  assert.equal(maskCPF("529982"), "529.982");
  assert.equal(maskCPF("5299822"), "529.982.2");
  assert.equal(maskCPF("52998224725"), "529.982.247-25");
  assert.equal(maskCPF("529982247259999"), "529.982.247-25");
  assert.equal(maskCPF("abc"), "");
});

test("maskCNPJ é progressiva e limita a 14 dígitos", () => {
  assert.equal(maskCNPJ("11"), "11");
  assert.equal(maskCNPJ("11222"), "11.222");
  assert.equal(maskCNPJ("11222333"), "11.222.333");
  assert.equal(maskCNPJ("112223330001"), "11.222.333/0001");
  assert.equal(maskCNPJ("11222333000181"), "11.222.333/0001-81");
  assert.equal(maskCNPJ("1122233300018199"), "11.222.333/0001-81");
});

test("maskPhone cobre celular (11) e fixo (10)", () => {
  assert.equal(maskPhone(""), "");
  assert.equal(maskPhone("1"), "(1");
  assert.equal(maskPhone("11"), "(11");
  assert.equal(maskPhone("119"), "(11) 9");
  assert.equal(maskPhone("1198888"), "(11) 9888-8");
  assert.equal(maskPhone("1188887777"), "(11) 8888-7777");
  assert.equal(maskPhone("11988887777"), "(11) 98888-7777");
  assert.equal(maskPhone("(11) 98888-7777 99"), "(11) 98888-7777");
});

test("maskCEP", () => {
  assert.equal(maskCEP("01310"), "01310");
  assert.equal(maskCEP("01310100"), "01310-100");
  assert.equal(maskCEP("01310-1009"), "01310-100");
});
