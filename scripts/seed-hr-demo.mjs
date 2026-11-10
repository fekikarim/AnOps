#!/usr/bin/env node
/**
 * AnOps Full-Year HR & Leave Demo Data Seeder
 * 
 * Generates an enterprise-scale full-year dataset (2026):
 * - 8 Diverse employees across Engineering, Design, QA, Sales, and HR
 * - Full 11 months of Leave Accruals (Jan 2026 -> Nov 2026)
 * - Seasonal leave requests across Spring, Summer, Autumn, and Winter (Taken, Reserved, Pending)
 * - 5 Full Months of Generated Payslips (July, August, September, October, November 2026)
 * - Recent daily Attendance punch-in/out logs
 * 
 * Usage:
 *   node scripts/seed-hr-demo.mjs
 *   node scripts/seed-hr-demo.mjs --clean
 *   node scripts/seed-hr-demo.mjs --company <company_id>
 *   MONGODB_URI="..." node scripts/seed-hr-demo.mjs --company <company_id>
 */

import { existsSync, readFileSync } from "node:fs";
import { MongoClient, ObjectId } from "mongodb";

// 1. Environment loading
if (!process.env.MONGODB_URI && existsSync(".env")) {
  const envContent = readFileSync(".env", "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("❌ MONGODB_URI is not set.");
  process.exit(1);
}

const args = process.argv.slice(2);
const isClean = args.includes("--clean");
const companyArgIdx = args.indexOf("--company");
const targetCompanyId = companyArgIdx !== -1 ? args[companyArgIdx + 1] : null;

async function run() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(client.options.dbName && client.options.dbName !== "test" ? client.options.dbName : "anops");
  console.log(`🔌 Connected to database: ${db.databaseName}`);

  let company;
  if (targetCompanyId) {
    company = await db.collection("companies").findOne({ _id: new ObjectId(targetCompanyId) });
    if (!company) {
      console.error(`❌ Company with ID ${targetCompanyId} not found.`);
      await client.close();
      process.exit(1);
    }
  } else {
    company = await db.collection("companies").findOne();
    if (!company) {
      console.error("❌ No company found.");
      await client.close();
      process.exit(1);
    }
  }

  const cId = company._id;
  console.log(`🏢 Target Company: "${company.name}" (ID: ${cId.toString()})`);

  if (isClean) {
    console.log("🧹 Cleaning demo HR records...");
    const demoEmps = await db.collection("employees").find({ companyId: cId, isDemo: true }).toArray();
    const demoEmpIds = demoEmps.map((e) => e._id.toString());

    if (demoEmpIds.length > 0) {
      await db.collection("leave_requests").deleteMany({ companyId: cId, employeeId: { $in: demoEmpIds } });
      await db.collection("leave_transactions").deleteMany({ companyId: cId, employeeId: { $in: demoEmpIds } });
      await db.collection("employee_leave_policies").deleteMany({ companyId: cId, employeeId: { $in: demoEmpIds } });
      await db.collection("payslips").deleteMany({ companyId: cId, employeeId: { $in: demoEmpIds } });
      await db.collection("attendance").deleteMany({ companyId: cId, employeeId: { $in: demoEmpIds } });
      await db.collection("employees").deleteMany({ companyId: cId, isDemo: true });
    }
    console.log(`✅ Cleaned ${demoEmpIds.length} demo employee(s) and all their associated records.`);
    await client.close();
    return;
  }

  // 1. Departments
  console.log("\n📁 1. Ensuring Departments...");
  const deptDefs = [
    { name: "Engineering", description: "Software development and cloud infrastructure" },
    { name: "Product & Design", description: "UI/UX design, UX research, and product strategy" },
    { name: "Quality Assurance", description: "Automated QA and integration testing" },
    { name: "Sales & Marketing", description: "Enterprise sales, client success, and growth" },
    { name: "Human Resources", description: "People operations, talent, and compliance" },
  ];

  const deptMap = {};
  for (const def of deptDefs) {
    let dept = await db.collection("departments").findOne({ companyId: cId, name: def.name });
    if (!dept) {
      const ins = await db.collection("departments").insertOne({
        ...def,
        companyId: cId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      dept = { _id: ins.insertedId, name: def.name };
      console.log(`   + Created: ${def.name}`);
    }
    deptMap[def.name] = dept._id.toString();
  }

  // 2. Leave Types
  console.log("\n🏖️ 2. Ensuring Leave Types...");
  const typeDefs = [
    { name: "Annual Paid Leave", code: "CP", isPaid: true, requiresApproval: true, requiresDocument: false },
    { name: "Sick Leave", code: "SICK", isPaid: true, requiresApproval: true, requiresDocument: true },
    { name: "Special / Family Leave", code: "EXCEPTIONAL", isPaid: true, requiresApproval: true, requiresDocument: true },
    { name: "Unpaid Leave", code: "UNPAID", isPaid: false, requiresApproval: true, requiresDocument: false },
  ];

  const typeMap = {};
  for (const def of typeDefs) {
    let t = await db.collection("leave_types").findOne({ companyId: cId, code: def.code });
    if (!t) {
      const ins = await db.collection("leave_types").insertOne({
        ...def,
        isActive: true,
        companyId: cId,
        createdAt: new Date(),
      });
      t = { _id: ins.insertedId, code: def.code };
      console.log(`   + Created: ${def.name} (${def.code})`);
    }
    typeMap[def.code] = t._id.toString();
  }

  // 3. Leave Policies
  console.log("\n⚖️ 3. Ensuring Leave Policies...");
  const policyDefs = [
    {
      name: "Standard Adult Policy (Art. 113-114)",
      country: "TN",
      employeeCategory: "adult",
      accrualRate: 1.0,
      annualCap: 15,
      accrualPeriod: "monthly",
      legalReference: "Code du Travail Art. 113-114",
    },
    {
      name: "Young Adult Policy 18-20 ans (Art. 114)",
      country: "TN",
      employeeCategory: "young_adult",
      accrualRate: 1.5,
      annualCap: 22.5,
      accrualPeriod: "monthly",
      legalReference: "Code du Travail Art. 114",
    },
    {
      name: "Under 18 Policy (Art. 114)",
      country: "TN",
      employeeCategory: "under_18",
      accrualRate: 2.0,
      annualCap: 30,
      accrualPeriod: "monthly",
      legalReference: "Code du Travail Art. 114",
    },
  ];

  const policyMap = {};
  for (const def of policyDefs) {
    let p = await db.collection("leave_policies").findOne({ companyId: cId, employeeCategory: def.employeeCategory });
    if (!p) {
      const ins = await db.collection("leave_policies").insertOne({
        ...def,
        referencePeriodType: "calendar_year",
        calculationMethod: "standard_monthly",
        roundingRule: "half_day",
        effectiveFrom: "2024-01-01",
        isActive: true,
        companyId: cId,
        createdAt: new Date(),
      });
      p = { _id: ins.insertedId, name: def.name };
      console.log(`   + Created policy: ${def.name}`);
    }
    policyMap[def.employeeCategory] = p._id.toString();
  }

  // 4. Public Holidays 2026
  console.log("\n🇹🇳 4. Ensuring Public Holidays...");
  const currentYear = 2026;
  const holidays = [
    { name: "New Year's Day", date: `${currentYear}-01-01` },
    { name: "Revolution Day", date: `${currentYear}-01-14` },
    { name: "Independence Day", date: `${currentYear}-03-20` },
    { name: "Martyrs' Day", date: `${currentYear}-04-09` },
    { name: "Labour Day", date: `${currentYear}-05-01` },
    { name: "Republic Day", date: `${currentYear}-07-25` },
    { name: "Women's Day", date: `${currentYear}-08-13` },
    { name: "Evacuation Day", date: `${currentYear}-10-15` },
  ];

  for (const h of holidays) {
    const exists = await db.collection("public_holidays").findOne({ companyId: cId, date: h.date });
    if (!exists) {
      await db.collection("public_holidays").insertOne({ ...h, isHalfDay: false, companyId: cId });
    }
  }
  console.log(`   ✓ 8 Tunisian public holidays verified for ${currentYear}.`);

  // 5. Eight Realistic Demo Employees
  console.log("\n👥 5. Injecting 8 Demo Employees across the Year...");

  const demoEmployees = [
    {
      fullName: "Sarah Ben Salem",
      email: "sarah.bensalem@demo.anops.tn",
      phone: "+216 71 100 201",
      jobTitle: "Senior Software Engineer",
      departmentId: deptMap["Engineering"],
      departmentName: "Engineering",
      hireDate: "2026-01-05",
      dateOfBirth: "1994-06-15",
      baseSalary: 4200,
      role: "employee",
      status: "active",
      leaveAllowance: 12,
      category: "adult",
      accrualRate: 1.0,
    },
    {
      fullName: "Youssef Trabelsi",
      email: "youssef.trabelsi@demo.anops.tn",
      phone: "+216 71 100 202",
      jobTitle: "Junior UI Designer",
      departmentId: deptMap["Product & Design"],
      departmentName: "Product & Design",
      hireDate: "2026-02-01",
      dateOfBirth: "2007-03-10", // 19 yo -> Young Adult (1.5d/mo)
      baseSalary: 2300,
      role: "employee",
      status: "active",
      leaveAllowance: 18,
      category: "young_adult",
      accrualRate: 1.5,
    },
    {
      fullName: "Amira Gharbi",
      email: "amira.gharbi@demo.anops.tn",
      phone: "+216 71 100 203",
      jobTitle: "QA Lead",
      departmentId: deptMap["Quality Assurance"],
      departmentName: "Quality Assurance",
      hireDate: "2026-01-10",
      dateOfBirth: "1997-11-20",
      baseSalary: 3400,
      role: "employee",
      status: "active",
      leaveAllowance: 12,
      category: "adult",
      accrualRate: 1.0,
    },
    {
      fullName: "Karim Mansour",
      email: "karim.mansour@demo.anops.tn",
      phone: "+216 71 100 204",
      jobTitle: "Senior Account Executive",
      departmentId: deptMap["Sales & Marketing"],
      departmentName: "Sales & Marketing",
      hireDate: "2025-06-01",
      dateOfBirth: "1991-04-12",
      baseSalary: 3800,
      role: "employee",
      status: "active",
      leaveAllowance: 12,
      category: "adult",
      accrualRate: 1.0,
    },
    {
      fullName: "Nour Khemir",
      email: "nour.khemir@demo.anops.tn",
      phone: "+216 71 100 205",
      jobTitle: "DevOps Engineer",
      departmentId: deptMap["Engineering"],
      departmentName: "Engineering",
      hireDate: "2026-01-15",
      dateOfBirth: "1993-09-08",
      baseSalary: 4400,
      role: "employee",
      status: "active",
      leaveAllowance: 12,
      category: "adult",
      accrualRate: 1.0,
    },
    {
      fullName: "Hedi Bouazizi",
      email: "hedi.bouazizi@demo.anops.tn",
      phone: "+216 71 100 206",
      jobTitle: "Lead Product Manager",
      departmentId: deptMap["Product & Design"],
      departmentName: "Product & Design",
      hireDate: "2026-01-05",
      dateOfBirth: "1989-12-04",
      baseSalary: 4900,
      role: "manager",
      status: "active",
      leaveAllowance: 12,
      category: "adult",
      accrualRate: 1.0,
    },
    {
      fullName: "Ines Ben Amor",
      email: "ines.benamor@demo.anops.tn",
      phone: "+216 71 100 207",
      jobTitle: "HR Specialist",
      departmentId: deptMap["Human Resources"],
      departmentName: "Human Resources",
      hireDate: "2026-02-15",
      dateOfBirth: "1996-07-22",
      baseSalary: 2900,
      role: "hr_admin",
      status: "active",
      leaveAllowance: 12,
      category: "adult",
      accrualRate: 1.0,
    },
    {
      fullName: "Tarek Ayari",
      email: "tarek.ayari@demo.anops.tn",
      phone: "+216 71 100 208",
      jobTitle: "Frontend Developer",
      departmentId: deptMap["Engineering"],
      departmentName: "Engineering",
      hireDate: "2026-03-01",
      dateOfBirth: "1999-05-18",
      baseSalary: 3100,
      role: "employee",
      status: "active",
      leaveAllowance: 12,
      category: "adult",
      accrualRate: 1.0,
    },
  ];

  const empMap = {};
  for (const empData of demoEmployees) {
    const { category, accrualRate, ...empFields } = empData;

    let emp = await db.collection("employees").findOne({ companyId: cId, email: empFields.email });
    if (!emp) {
      const ins = await db.collection("employees").insertOne({
        ...empFields,
        companyId: cId,
        isDemo: true,
        createdAt: new Date(empFields.hireDate),
        updatedAt: new Date(),
      });
      emp = { _id: ins.insertedId, ...empFields };
    } else {
      await db.collection("employees").updateOne(
        { _id: emp._id },
        { $set: { ...empFields, isDemo: true, status: "active", updatedAt: new Date() } }
      );
    }
    const empId = emp._id.toString();
    empMap[empFields.email] = { ...emp, id: empId, accrualRate, category };
    console.log(`   👤 Employee: ${emp.fullName} — ${emp.jobTitle} (${empFields.departmentName})`);

    // Assign policy
    await db.collection("employee_leave_policies").deleteMany({ companyId: cId, employeeId: empId });
    await db.collection("employee_leave_policies").insertOne({
      companyId: cId,
      employeeId: empId,
      leavePolicyId: policyMap[category] || policyMap["adult"],
      policyName: category === "young_adult" ? "Young Adult Policy 18-20 ans (Art. 114)" : "Standard Adult Policy (Art. 113-114)",
      effectiveFrom: emp.hireDate,
      assignedBy: "system_seeder",
      assignedAt: new Date(emp.hireDate),
    });

    // Clean previous leave records for fresh full-year injection
    await db.collection("leave_requests").deleteMany({ companyId: cId, employeeId: empId });
    await db.collection("leave_transactions").deleteMany({ companyId: cId, employeeId: empId });
  }

  // 6. Inject Full-Year Monthly Accruals (Jan -> Nov 2026)
  console.log("\n📈 6. Generating Full-Year Monthly Accruals (Jan 2026 -> Nov 2026)...");
  const months = [
    { period: "2026-01", date: "2026-01-31" },
    { period: "2026-02", date: "2026-02-28" },
    { period: "2026-03", date: "2026-03-31" },
    { period: "2026-04", date: "2026-04-30" },
    { period: "2026-05", date: "2026-05-31" },
    { period: "2026-06", date: "2026-06-30" },
    { period: "2026-07", date: "2026-07-31" },
    { period: "2026-08", date: "2026-08-31" },
    { period: "2026-09", date: "2026-09-30" },
    { period: "2026-10", date: "2026-10-31" },
    { period: "2026-11", date: "2026-11-01" },
  ];

  for (const emp of Object.values(empMap)) {
    for (const m of months) {
      if (emp.hireDate <= m.date) {
        await db.collection("leave_transactions").insertOne({
          companyId: cId,
          employeeId: emp.id,
          employeeName: emp.fullName,
          leaveTypeId: typeMap["CP"],
          leaveTypeCode: "CP",
          transactionType: "ACCRUAL",
          days: emp.accrualRate,
          effectiveDate: m.date,
          referenceId: `ACCRUAL_${m.period}`,
          description: `Monthly leave accrual — Period ${m.period} (+${emp.accrualRate}d)`,
          createdBy: "HR Administrator",
          createdAt: new Date(`${m.date}T08:00:00Z`),
        });
      }
    }
  }
  console.log("   ✓ Generated monthly accrual ledgers for all 8 employees across 11 months.");

  // 7. Inject Year-Long Leave Requests (Taken, Reserved, Pending)
  console.log("\n🏖️ 7. Generating Year-Long Leave Requests across all Seasons...");

  const sarah = empMap["sarah.bensalem@demo.anops.tn"];
  const youssef = empMap["youssef.trabelsi@demo.anops.tn"];
  const amira = empMap["amira.gharbi@demo.anops.tn"];
  const karim = empMap["karim.mansour@demo.anops.tn"];
  const nour = empMap["nour.khemir@demo.anops.tn"];
  const hedi = empMap["hedi.bouazizi@demo.anops.tn"];

  // Helper to record an approved + taken leave with both request and transaction
  async function recordTakenLeave(emp, typeCode, start, end, days, reason) {
    const reqId = new ObjectId();
    await db.collection("leave_requests").insertOne({
      _id: reqId,
      companyId: cId,
      employeeId: emp.id,
      employeeName: emp.fullName,
      departmentName: emp.departmentName,
      leaveType: typeCode === "CP" ? "annual" : typeCode === "SICK" ? "sick" : "unpaid",
      leaveTypeId: typeMap[typeCode],
      isPaid: typeCode !== "UNPAID",
      startDate: start,
      endDate: end,
      days,
      reason,
      status: "taken",
      reviewedBy: "HR Administrator",
      createdAt: new Date(`${start}T08:00:00Z`),
      updatedAt: new Date(`${end}T18:00:00Z`),
    });

    if (typeCode === "CP") {
      await db.collection("leave_transactions").insertOne({
        companyId: cId,
        employeeId: emp.id,
        employeeName: emp.fullName,
        leaveTypeId: typeMap["CP"],
        leaveTypeCode: "CP",
        transactionType: "TAKEN",
        days,
        effectiveDate: end,
        referenceId: reqId.toString(),
        description: `Paid leave taken #${reqId.toString().slice(-6)} (${start} → ${end})`,
        createdBy: "system_scheduler",
        createdAt: new Date(`${end}T18:00:00Z`),
      });
    }
  }

  // Sarah: Spring vacation (April, 2d), Summer vacation (August, 3d), Future December trip (2d reserved)
  await recordTakenLeave(sarah, "CP", "2026-04-13", "2026-04-14", 2, "Spring break family trip");
  await recordTakenLeave(sarah, "CP", "2026-08-10", "2026-08-12", 3, "Annual summer holiday");

  const sarahFutureReqId = new ObjectId();
  await db.collection("leave_requests").insertOne({
    _id: sarahFutureReqId,
    companyId: cId,
    employeeId: sarah.id,
    employeeName: sarah.fullName,
    departmentName: sarah.departmentName,
    leaveType: "annual",
    leaveTypeId: typeMap["CP"],
    isPaid: true,
    startDate: "2026-12-24",
    endDate: "2026-12-25",
    days: 2,
    reason: "End-of-year holiday",
    status: "approved",
    reviewedBy: "HR Administrator",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await db.collection("leave_transactions").insertOne({
    companyId: cId,
    employeeId: sarah.id,
    employeeName: sarah.fullName,
    leaveTypeId: typeMap["CP"],
    leaveTypeCode: "CP",
    transactionType: "RESERVATION",
    days: 2,
    effectiveDate: "2026-12-24",
    referenceId: sarahFutureReqId.toString(),
    description: `Reservation for leave request #${sarahFutureReqId.toString().slice(-6)} (2026-12-24 → 2026-12-25)`,
    createdBy: "HR Administrator",
    createdAt: new Date(),
  });

  // Youssef: Summer break (July, 3d) + Pending request in November (2d)
  await recordTakenLeave(youssef, "CP", "2026-07-20", "2026-07-22", 3, "Summer festival break");
  await db.collection("leave_requests").insertOne({
    companyId: cId,
    employeeId: youssef.id,
    employeeName: youssef.fullName,
    departmentName: youssef.departmentName,
    leaveType: "annual",
    leaveTypeId: typeMap["CP"],
    isPaid: true,
    startDate: "2026-11-20",
    endDate: "2026-11-23",
    days: 2,
    reason: "Extended weekend trip",
    status: "pending",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // Amira: Medical leave (September, 2d) + Pending Single-Day Half-Day in November (0.5d)
  await recordTakenLeave(amira, "SICK", "2026-09-08", "2026-09-09", 2, "Flu recovery with medical certificate");
  await db.collection("leave_requests").insertOne({
    companyId: cId,
    employeeId: amira.id,
    employeeName: amira.fullName,
    departmentName: amira.departmentName,
    leaveType: "annual",
    leaveTypeId: typeMap["CP"],
    isPaid: true,
    startDate: "2026-11-18",
    endDate: "2026-11-18",
    days: 0.5,
    halfDayOption: "morning",
    reason: "Administrative appointment (morning only)",
    status: "pending",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // Approval Advisor demo. Youssef's pending November leave overlaps Hedi, his only colleague in Product & Design:
  // an approved reservation for Hedi makes that request "Review".
  const hediOverlapId = new ObjectId();
  await db.collection("leave_requests").insertOne({
    _id: hediOverlapId,
    companyId: cId,
    employeeId: empMap["hedi.bouazizi@demo.anops.tn"].id,
    employeeName: empMap["hedi.bouazizi@demo.anops.tn"].fullName,
    departmentName: empMap["hedi.bouazizi@demo.anops.tn"].departmentName,
    leaveType: "annual",
    leaveTypeId: typeMap["CP"],
    isPaid: true,
    startDate: "2026-11-23",
    endDate: "2026-11-24",
    days: 2,
    reason: "Family visit",
    status: "approved",
    reviewedBy: "HR Administrator",
    reviewedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await db.collection("leave_transactions").insertOne({
    companyId: cId,
    employeeId: empMap["hedi.bouazizi@demo.anops.tn"].id,
    employeeName: empMap["hedi.bouazizi@demo.anops.tn"].fullName,
    leaveTypeId: typeMap["CP"],
    leaveTypeCode: "CP",
    transactionType: "RESERVATION",
    days: 2,
    effectiveDate: "2026-11-23",
    referenceId: hediOverlapId.toString(),
    description: "Reservation for approved leave (2026-11-23 → 2026-11-24)",
    createdBy: "HR Administrator",
    createdAt: new Date(),
  });

  // Tarek's December request is far above his balance, so the advisor shows "Blocked".
  // Ines's request is otherwise fine; her attendance gap (seeded below) makes it "Review".
  await db.collection("leave_requests").insertMany(
    [
      { emp: empMap["tarek.ayari@demo.anops.tn"], startDate: "2026-12-14", endDate: "2027-01-22", days: 28, reason: "Extended year-end travel" },
      { emp: empMap["ines.benamor@demo.anops.tn"], startDate: "2026-12-03", endDate: "2026-12-03", days: 1, reason: "Personal appointment" },
    ].map(({ emp, ...fields }) => ({
      companyId: cId,
      employeeId: emp.id,
      employeeName: emp.fullName,
      departmentName: emp.departmentName,
      leaveType: "annual",
      leaveTypeId: typeMap["CP"],
      isPaid: true,
      status: "pending",
      createdAt: new Date(),
      updatedAt: new Date(),
      ...fields,
    }))
  );

  // Karim: Spring leave (March, 2d) -> leaves 10d unconsumed ready for offboarding demo
  await recordTakenLeave(karim, "CP", "2026-03-12", "2026-03-13", 2, "Personal time off");

  // Hedi: Summer leave (August, 4d)
  await recordTakenLeave(hedi, "CP", "2026-08-17", "2026-08-20", 4, "Summer family vacation");

  // -------------------------------------------------------------
  // DIVERSE UNPAID LEAVES ACROSS THE YEAR (For Varied Payroll Deductions)
  // -------------------------------------------------------------
  const tarek = empMap["tarek.ayari@demo.anops.tn"];
  const ines = empMap["ines.benamor@demo.anops.tn"];

  const unpaidLeaveRecords = [
    // July 2026: Tarek Ayari (1 day unpaid)
    {
      emp: tarek,
      start: "2026-07-10",
      end: "2026-07-10",
      days: 1,
      reason: "Extended personal weekend (unpaid leave)",
    },
    // August 2026: Karim Mansour (3 days unpaid)
    {
      emp: karim,
      start: "2026-08-24",
      end: "2026-08-26",
      days: 3,
      reason: "Apartment moving & relocation (unpaid leave)",
    },
    // September 2026: Hedi Bouazizi (1 day unpaid)
    {
      emp: hedi,
      start: "2026-09-18",
      end: "2026-09-18",
      days: 1,
      reason: "Personal family business (unpaid leave)",
    },
    // October 2026: Nour Khemir (2 days unpaid)
    {
      emp: nour,
      start: "2026-10-15",
      end: "2026-10-16",
      days: 2,
      reason: "Urgent family matter (unpaid leave)",
    },
    // October 2026: Ines Ben Amor (1 day unpaid)
    {
      emp: ines,
      start: "2026-10-23",
      end: "2026-10-23",
      days: 1,
      reason: "Personal appointment absence (unpaid leave)",
    },
    // November 2026: Nour Khemir (2 days unpaid)
    {
      emp: nour,
      start: "2026-11-05",
      end: "2026-11-06",
      days: 2,
      reason: "Personal leave (unpaid)",
    },
    // November 2026: Youssef Trabelsi (1 day unpaid)
    {
      emp: youssef,
      start: "2026-11-09",
      end: "2026-11-09",
      days: 1,
      reason: "Design conference / study day (unpaid leave)",
    },
  ];

  for (const ul of unpaidLeaveRecords) {
    await db.collection("leave_requests").insertOne({
      companyId: cId,
      employeeId: ul.emp.id,
      employeeName: ul.emp.fullName,
      departmentName: ul.emp.departmentName,
      leaveType: "unpaid",
      leaveTypeId: typeMap["UNPAID"],
      isPaid: false,
      startDate: ul.start,
      endDate: ul.end,
      days: ul.days,
      reason: ul.reason,
      status: "approved",
      reviewedBy: "HR Administrator",
      createdAt: new Date(`${ul.start}T08:00:00Z`),
      updatedAt: new Date(`${ul.end}T18:00:00Z`),
    });
  }

  console.log("   ✓ Injected seasonal leave requests & varied unpaid leaves across the year.");

  // 8. Inject 5 Months of Complete Company Payslips (July -> November 2026)
  console.log("\n💰 8. Generating 5 Months of Historical Payslips (July, August, September, October, November)...");
  const payrollMonths = ["2026-07", "2026-08", "2026-09", "2026-10", "2026-11"];

  await db.collection("payslips").deleteMany({
    companyId: cId,
    employeeId: { $in: Object.values(empMap).map((e) => e.id) },
  });

  for (const pMonth of payrollMonths) {
    for (const emp of Object.values(empMap)) {
      if (emp.hireDate > `${pMonth}-28`) continue;

      // Find all approved unpaid leaves for this employee in this month
      const empUnpaids = unpaidLeaveRecords.filter(
        (ul) => ul.emp.id === emp.id && ul.start.startsWith(pMonth)
      );
      const unpaidDays = empUnpaids.reduce((sum, ul) => sum + ul.days, 0);

      const dailyRate = Math.round((emp.baseSalary / 22) * 100) / 100;
      const deduction = Math.round((dailyRate * unpaidDays) * 100) / 100;
      const netSalary = Math.round((emp.baseSalary - deduction) * 100) / 100;

      await db.collection("payslips").insertOne({
        companyId: cId,
        employeeId: emp.id,
        employeeName: emp.fullName,
        jobTitle: emp.jobTitle,
        departmentName: emp.departmentName,
        period: pMonth,
        baseSalary: emp.baseSalary,
        workingDaysInMonth: 22,
        dailyRate,
        unpaidLeaveDays: unpaidDays,
        deduction,
        netSalary,
        currency: "TND",
        status: "generated",
        generatedAt: new Date(`${pMonth}-28T16:00:00Z`),
      });
    }
  }
  console.log("   ✓ Generated payslips for all staff across 5 periods (July -> November 2026).");

  // 9. Inject Recent Attendance Records
  console.log("\n⏱️ 9. Generating Attendance History...");
  await db.collection("attendance").deleteMany({
    companyId: cId,
    employeeId: { $in: Object.values(empMap).map((e) => e.id) },
  });

  // Working days of the last 45 days, so the Approval Advisor has real attendance to read.
  const seededHolidays = new Set(
    (await db.collection("public_holidays").find({ companyId: cId }).toArray()).map((h) => h.date)
  );
  const recentDates = [];
  for (let back = 45; back >= 1; back--) {
    const day = new Date(Date.now() - back * 86_400_000);
    const ymd = day.toISOString().slice(0, 10);
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6 && !seededHolidays.has(ymd)) recentDates.push(ymd);
  }

  const leaveDocs = await db
    .collection("leave_requests")
    .find({ companyId: cId, status: { $in: ["approved", "taken"] } }, { projection: { employeeId: 1, startDate: 1, endDate: 1 } })
    .toArray();
  const onLeave = (empId, date) =>
    leaveDocs.some((l) => l.employeeId === empId && l.startDate <= date && l.endDate >= date);

  // Advisor demo: Ines misses recent days with no approved leave, and Tarek often arrives after the flex window.
  const absentDays = new Map([[ines.id, new Set(recentDates.slice(-8, -3))]]);
  const lateDays = new Map([[tarek.id, new Set(recentDates.slice(-6))]]);

  const attendanceDocs = [];
  for (const rDate of recentDates) {
    for (const emp of Object.values(empMap)) {
      if (rDate < emp.hireDate || onLeave(emp.id, rDate) || absentDays.get(emp.id)?.has(rDate)) continue;
      // 08:30Z is 09:30 in Tunis, the end of the flex window. 09:15Z is 10:15, so late.
      const checkIn = lateDays.get(emp.id)?.has(rDate) ? `${rDate}T09:15:00Z` : `${rDate}T08:30:00Z`;
      attendanceDocs.push({
        companyId: cId,
        employeeId: emp.id,
        employeeName: emp.fullName,
        departmentName: emp.departmentName,
        date: rDate,
        checkIn: new Date(checkIn),
        checkOut: new Date(`${rDate}T17:30:00Z`),
        hoursWorked: 8.5,
        status: "checked_out",
        createdAt: new Date(checkIn),
        updatedAt: new Date(`${rDate}T17:30:00Z`),
      });
    }
  }
  await db.collection("attendance").insertMany(attendanceDocs);
  console.log("   ✓ Generated attendance check-in/out logs for all active staff.");

  console.log("\n========================================================");
  console.log("🎉 FULL-YEAR HR DEMO DATASET INJECTED SUCCESSFULLY!");
  console.log("========================================================");
  console.log("Summary of available demo data across the year:");
  console.log("  • 8 Employees across Engineering, Design, QA, Sales, and HR");
  console.log("  • Full 11 months of Monthly Accruals (Jan 2026 -> Nov 2026)");
  console.log("  • Seasonal leave requests (Spring, Summer, Autumn, Winter)");
  console.log("  • 5 Complete Monthly Payroll Periods (2026-07, 2026-08, 2026-09, 2026-10, 2026-11)");
  console.log("  • Nour Khemir has 400 TND deduction in both 2026-10 and 2026-11 (Net 4,000 TND)");
  console.log("========================================================\n");

  await client.close();
}

run().catch((err) => {
  console.error("❌ Error running seed script:", err);
  process.exit(1);
});
