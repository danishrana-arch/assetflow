const prisma = require("../lib/prisma")
const { isManagement } = require("../utils/roles")

async function getEmployee360(req, res, next) {
  try {
    const { organizationId, userId, role } = req.user
    const employeeId = req.params.id
    if (!isManagement(role) && employeeId !== userId) return res.status(403).json({ error: "You can only view your own 360 profile" })
    const employee = await prisma.user.findFirst({
      where: { id: employeeId, organizationId },
      select: {
        id:true,name:true,email:true,phone:true,photoUrl:true,role:true,status:true,designation:true,skill:true,seniorityLevel:true,joiningDate:true,dob:true,department:{select:{id:true,name:true}},manager:{select:{id:true,name:true,email:true}},
        assignedAssets:{select:{id:true,name:true,category:true,status:true,serialNumber:true,warrantyEnd:true}},
        certifications:{orderBy:{expiryDate:"asc"}},
        projectMemberships:{include:{project:{select:{id:true,name:true,status:true,deadline:true,totalHours:true,workCategory:{select:{name:true}}}}},orderBy:{createdAt:"desc"}},
        tickets:{orderBy:{createdAt:"desc"},take:20,select:{id:true,subject:true,status:true,priority:true,createdAt:true,updatedAt:true}},
      },
    })
    if (!employee) return res.status(404).json({ error: "Employee not found" })
    const since = new Date(); since.setDate(since.getDate()-90)
    const [attendance, leaves, performance] = await Promise.all([
      prisma.attendanceRecord.findMany({where:{organizationId,employeeId,date:{gte:since}},orderBy:{date:"desc"},take:90}),
      prisma.leaveApplication.findMany({where:{organizationId,employeeId},orderBy:{startDate:"desc"},take:20}),
      prisma.performanceReview.findMany({where:{organizationId,employeeId},include:{reviewer:{select:{id:true,name:true,role:true}}},orderBy:{periodEnd:"desc"}}),
    ])
    const present = attendance.filter(a=>a.status === "PRESENT").length
    const late = attendance.filter(a=>a.status === "LATE").length
    const attendanceRate = attendance.length ? Math.round(present / attendance.length * 100) : 0
    const completedProjects = employee.projectMemberships.filter(m=>m.project.status === "COMPLETED").length
    const activeProjects = employee.projectMemberships.filter(m=>m.project.status === "IN_PROGRESS").length
    const averageRating = performance.length ? Math.round(performance.reduce((sum,r)=>sum+Number(r.rating),0)/performance.length*100)/100 : null
    res.json({ employee, attendance, leaves, performance, metrics:{attendanceRate,late,activeProjects,completedProjects,assets:employee.assignedAssets.length,certifications:employee.certifications.length,averageRating} })
  } catch (err) { next(err) }
}
module.exports = { getEmployee360 }
